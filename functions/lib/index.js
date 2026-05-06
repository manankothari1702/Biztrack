"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testWhatsAppReport = exports.sendDailyReports = exports.onUserStatusChanged = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firebase_functions_1 = require("firebase-functions");
const admin = __importStar(require("firebase-admin"));
const axios_1 = __importDefault(require("axios"));
admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
// ---------------------------------------------------------------------------
// Secrets (set via: firebase functions:secrets:set WHATSAPP_TOKEN etc.)
// ---------------------------------------------------------------------------
const WHATSAPP_TOKEN = (0, params_1.defineSecret)("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_ID = (0, params_1.defineSecret)("WHATSAPP_PHONE_ID");
// ---------------------------------------------------------------------------
// Existing: Account Deletion
// ---------------------------------------------------------------------------
exports.onUserStatusChanged = (0, firestore_1.onDocumentUpdated)({
    document: "users/{uid}",
    timeoutSeconds: 540,
    memory: "1GiB",
}, async (event) => {
    const snapshot = event.data;
    if (!snapshot)
        return;
    const newData = snapshot.after.data();
    const previousData = snapshot.before.data();
    if (!newData || !previousData)
        return;
    if (newData.deletionRequested !== true || previousData.deletionRequested === true) {
        return;
    }
    const uid = event.params.uid;
    firebase_functions_1.logger.info("Account deletion requested", { uid: uid.slice(0, 8) });
    if (newData.deletionStatus === "PROCESSING" || newData.deletionStatus === "COMPLETED") {
        firebase_functions_1.logger.info("Deletion already in progress or completed", { uid: uid.slice(0, 8) });
        return;
    }
    try {
        await snapshot.after.ref.update({
            deletionStatus: "PROCESSING",
            deletionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        firebase_functions_1.logger.info("Starting recursive delete", { uid: uid.slice(0, 8) });
        await db.recursiveDelete(snapshot.after.ref);
        try {
            await auth.deleteUser(uid);
            firebase_functions_1.logger.info("Auth user deleted", { uid: uid.slice(0, 8) });
        }
        catch (authError) {
            if (authError.code === "auth/user-not-found") {
                firebase_functions_1.logger.info("Auth user already deleted", { uid: uid.slice(0, 8) });
            }
            else {
                throw authError;
            }
        }
        firebase_functions_1.logger.info("Account deletion completed", { uid: uid.slice(0, 8) });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        firebase_functions_1.logger.error("Account deletion failed", { uid: uid.slice(0, 8), error: message });
        const docSnap = await snapshot.after.ref.get();
        if (docSnap.exists) {
            await snapshot.after.ref.update({
                deletionStatus: "FAILED",
                deletionError: message,
            });
        }
    }
});
const sendWhatsAppMessage = async (token, phoneNumberId, to, // E.164 without +, e.g. "919876543210"
body) => {
    await axios_1.default.post(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
    }, {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
    });
};
const buildReportMessage = (name, dueClients, tasks) => {
    const today = new Date().toLocaleDateString("en-IN", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    let msg = `📋 *BizTrack Daily Report*\n📅 ${today}\nHi ${name}!\n\n`;
    if (dueClients.length === 0) {
        msg += `📞 *Calls Due Today*\n✅ All caught up — no calls due!\n\n`;
    }
    else {
        msg += `📞 *Calls Due Today (${dueClients.length})*\n`;
        dueClients.slice(0, 15).forEach(c => {
            msg += `• ${c.clientName}${c.frequency ? ` — ${c.frequency}` : ""}\n`;
        });
        if (dueClients.length > 15)
            msg += `…and ${dueClients.length - 15} more\n`;
        msg += "\n";
    }
    const highTasks = tasks.filter(t => t.priority === "High");
    if (highTasks.length === 0) {
        msg += `✅ *High Priority Tasks*\nNo high priority tasks today.\n\n`;
    }
    else {
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
const fetchAndSendReport = async (uid, token, phoneNumberId) => {
    const userDoc = await db.doc(`users/${uid}`).get();
    if (!userDoc.exists)
        return;
    const userData = userDoc.data();
    const { name = "there", phoneNumber, countryCode = "+91" } = userData;
    if (!phoneNumber) {
        firebase_functions_1.logger.warn("No phone number for user, skipping", { uid: uid.slice(0, 8) });
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
    const dueClients = clientsSnap.docs.map(d => d.data());
    const tasks = tasksSnap.docs.map(d => d.data());
    const message = buildReportMessage(name, dueClients, tasks);
    try {
        await sendWhatsAppMessage(token, phoneNumberId, to, message);
        await db.doc(`users/${uid}`).update({
            lastReportSentAt: new Date().toISOString(),
            lastReportStatus: "delivered",
        });
        firebase_functions_1.logger.info("Report sent", { uid: uid.slice(0, 8) });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        firebase_functions_1.logger.error("WhatsApp send failed", { uid: uid.slice(0, 8), error: msg });
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
exports.sendDailyReports = (0, scheduler_1.onSchedule)({
    schedule: "every 1 minutes",
    timeZone: "UTC",
    secrets: [WHATSAPP_TOKEN, WHATSAPP_PHONE_ID],
    memory: "256MiB",
    timeoutSeconds: 120,
}, async () => {
    const token = WHATSAPP_TOKEN.value();
    const phoneNumId = WHATSAPP_PHONE_ID.value();
    // Query all users with reportEnabled == true
    const usersSnap = await db.collection("users")
        .where("reportEnabled", "==", true)
        .get();
    const now = new Date();
    const jobs = usersSnap.docs.map(async (doc) => {
        const data = doc.data();
        const { reportGenerationTime, timezone = "Asia/Kolkata" } = data;
        if (!reportGenerationTime)
            return;
        // Convert current UTC time to user's local HH:MM
        const localTime = now.toLocaleTimeString("en-GB", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }); // returns "HH:MM"
        if (localTime !== reportGenerationTime)
            return;
        // Guard: don't send twice in the same minute
        const lastSent = data.lastReportSentAt ? new Date(data.lastReportSentAt) : null;
        if (lastSent) {
            const diffMs = now.getTime() - lastSent.getTime();
            if (diffMs < 60000)
                return; // sent < 60s ago
        }
        await fetchAndSendReport(doc.id, token, phoneNumId);
    });
    await Promise.allSettled(jobs);
});
// ---------------------------------------------------------------------------
// HTTP Callable: instant test report for the authenticated caller
// ---------------------------------------------------------------------------
exports.testWhatsAppReport = (0, https_1.onCall)({
    secrets: [WHATSAPP_TOKEN, WHATSAPP_PHONE_ID],
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    const token = WHATSAPP_TOKEN.value();
    const phoneNumId = WHATSAPP_PHONE_ID.value();
    await fetchAndSendReport(request.auth.uid, token, phoneNumId);
    return { success: true };
});
//# sourceMappingURL=index.js.map