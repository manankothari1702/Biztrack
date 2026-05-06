import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import axios from "axios";

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

// ---------------------------------------------------------------------------
// Secrets (set via: firebase functions:secrets:set WHATSAPP_TOKEN etc.)
// ---------------------------------------------------------------------------
const WHATSAPP_TOKEN   = defineSecret("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_ID = defineSecret("WHATSAPP_PHONE_ID");

// ---------------------------------------------------------------------------
// Existing: Account Deletion
// ---------------------------------------------------------------------------

export const onUserStatusChanged = onDocumentUpdated(
    {
        document: "users/{uid}",
        timeoutSeconds: 540,
        memory: "1GiB",
    },
    async (event) => {
        const snapshot = event.data;
        if (!snapshot) return;

        const newData = snapshot.after.data();
        const previousData = snapshot.before.data();

        if (!newData || !previousData) return;

        if (newData.deletionRequested !== true || previousData.deletionRequested === true) {
            return;
        }

        const uid = event.params.uid;
        logger.info("Account deletion requested", { uid: uid.slice(0, 8) });

        if (newData.deletionStatus === "PROCESSING" || newData.deletionStatus === "COMPLETED") {
            logger.info("Deletion already in progress or completed", { uid: uid.slice(0, 8) });
            return;
        }

        try {
            await snapshot.after.ref.update({
                deletionStatus: "PROCESSING",
                deletionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            logger.info("Starting recursive delete", { uid: uid.slice(0, 8) });
            await db.recursiveDelete(snapshot.after.ref);

            try {
                await auth.deleteUser(uid);
                logger.info("Auth user deleted", { uid: uid.slice(0, 8) });
            } catch (authError: unknown) {
                if ((authError as { code?: string }).code === "auth/user-not-found") {
                    logger.info("Auth user already deleted", { uid: uid.slice(0, 8) });
                } else {
                    throw authError;
                }
            }

            logger.info("Account deletion completed", { uid: uid.slice(0, 8) });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            logger.error("Account deletion failed", { uid: uid.slice(0, 8), error: message });

            const docSnap = await snapshot.after.ref.get();
            if (docSnap.exists) {
                await snapshot.after.ref.update({
                    deletionStatus: "FAILED",
                    deletionError: message,
                });
            }
        }
    }
);

// ---------------------------------------------------------------------------
// WhatsApp Helpers
// ---------------------------------------------------------------------------

interface UserDoc {
    name?: string;
    phoneNumber?: string;
    countryCode?: string;
    reportEnabled?: boolean;
    reportGenerationTime?: string; // "HH:MM"
    timezone?: string;
    lastReportSentAt?: string;
}

const sendWhatsAppMessage = async (
    token: string,
    phoneNumberId: string,
    to: string,         // E.164 without +, e.g. "919876543210"
    body: string
): Promise<void> => {
    await axios.post(
        `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
        {
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body },
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        }
    );
};

const buildReportMessage = (
    name: string,
    dueClients: Array<{ clientName: string; frequency?: string }>,
    tasks: Array<{ title: string; priority: string; dueDate: string }>
): string => {
    const today = new Date().toLocaleDateString("en-IN", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
    });

    let msg = `📋 *BizTrack Daily Report*\n📅 ${today}\nHi ${name}!\n\n`;

    if (dueClients.length === 0) {
        msg += `📞 *Calls Due Today*\n✅ All caught up — no calls due!\n\n`;
    } else {
        msg += `📞 *Calls Due Today (${dueClients.length})*\n`;
        dueClients.slice(0, 15).forEach(c => {
            msg += `• ${c.clientName}${c.frequency ? ` — ${c.frequency}` : ""}\n`;
        });
        if (dueClients.length > 15) msg += `…and ${dueClients.length - 15} more\n`;
        msg += "\n";
    }

    const highTasks = tasks.filter(t => t.priority === "High");
    if (highTasks.length === 0) {
        msg += `✅ *High Priority Tasks*\nNo high priority tasks today.\n\n`;
    } else {
        msg += `⚡ *High Priority Tasks (${highTasks.length})*\n`;
        highTasks.slice(0, 10).forEach(t => {
            const due = new Date(t.dueDate);
            const isOverdue = due < new Date();
            msg += `• ${t.title}${isOverdue ? " ⚠️ Overdue" : ""}\n`;
        });
        msg += "\n";
    }

    msg += `_Sent by BizTrack • Have a productive day!_`;
    return msg;
};

const fetchAndSendReport = async (
    uid: string,
    token: string,
    phoneNumberId: string
): Promise<void> => {
    const userDoc = await db.doc(`users/${uid}`).get();
    if (!userDoc.exists) return;

    const userData = userDoc.data() as UserDoc;
    const { name = "there", phoneNumber, countryCode = "+91" } = userData;

    if (!phoneNumber) {
        logger.warn("No phone number for user, skipping", { uid: uid.slice(0, 8) });
        return;
    }

    const to = `${countryCode.replace("+", "")}${phoneNumber}`;

    // Fetch due clients (nextFollowUpDate <= today)
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const todayIso = today.toISOString();

    const [clientsSnap, tasksSnap] = await Promise.all([
        db.collection(`users/${uid}/clients`)
            .where("status", "==", "Active")
            .where("nextFollowUpDate", "<=", todayIso)
            .orderBy("nextFollowUpDate", "asc")
            .limit(50)
            .get(),
        db.collection(`users/${uid}/tasks`)
            .where("status", "!=", "Completed")
            .orderBy("status")
            .orderBy("dueDate", "asc")
            .limit(50)
            .get(),
    ]);

    const dueClients = clientsSnap.docs.map(d => d.data() as { clientName: string; frequency?: string });
    const tasks = tasksSnap.docs.map(d => d.data() as { title: string; priority: string; dueDate: string });

    const message = buildReportMessage(name, dueClients, tasks);

    try {
        await sendWhatsAppMessage(token, phoneNumberId, to, message);
        await db.doc(`users/${uid}`).update({
            lastReportSentAt: new Date().toISOString(),
            lastReportStatus: "delivered",
        });
        logger.info("Report sent", { uid: uid.slice(0, 8) });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("WhatsApp send failed", { uid: uid.slice(0, 8), error: msg });
        await db.doc(`users/${uid}`).update({
            lastReportSentAt: new Date().toISOString(),
            lastReportStatus: "failed",
        });
        throw err;
    }
};

// ---------------------------------------------------------------------------
// Scheduler: runs every minute, sends reports to users whose time matches now
// ---------------------------------------------------------------------------

export const sendDailyReports = onSchedule(
    {
        schedule: "every 1 minutes",
        timeZone: "UTC",
        secrets: [WHATSAPP_TOKEN, WHATSAPP_PHONE_ID],
        memory: "256MiB",
        timeoutSeconds: 120,
    },
    async () => {
        const token       = WHATSAPP_TOKEN.value();
        const phoneNumId  = WHATSAPP_PHONE_ID.value();

        // Query all users with reportEnabled == true
        const usersSnap = await db.collection("users")
            .where("reportEnabled", "==", true)
            .get();

        const now = new Date();

        const jobs = usersSnap.docs.map(async (doc) => {
            const data = doc.data() as UserDoc;
            const { reportGenerationTime, timezone = "Asia/Kolkata" } = data;
            if (!reportGenerationTime) return;

            // Convert current UTC time to user's local HH:MM
            const localTime = now.toLocaleTimeString("en-GB", {
                timeZone: timezone,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            }); // returns "HH:MM"

            if (localTime !== reportGenerationTime) return;

            // Guard: don't send twice in the same minute
            const lastSent = data.lastReportSentAt ? new Date(data.lastReportSentAt as string) : null;
            if (lastSent) {
                const diffMs = now.getTime() - lastSent.getTime();
                if (diffMs < 60_000) return; // sent < 60s ago
            }

            await fetchAndSendReport(doc.id, token, phoneNumId);
        });

        await Promise.allSettled(jobs);
    }
);

// ---------------------------------------------------------------------------
// HTTP Callable: instant test report for the authenticated caller
// ---------------------------------------------------------------------------

export const testWhatsAppReport = onCall(
    {
        secrets: [WHATSAPP_TOKEN, WHATSAPP_PHONE_ID],
        memory: "256MiB",
        timeoutSeconds: 30,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be signed in.");
        }

        const token      = WHATSAPP_TOKEN.value();
        const phoneNumId = WHATSAPP_PHONE_ID.value();

        await fetchAndSendReport(request.auth.uid, token, phoneNumId);
        return { success: true };
    }
);
