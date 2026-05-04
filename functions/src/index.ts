import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

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

        // Only act when deletionRequested transitions from false → true
        if (newData.deletionRequested !== true || previousData.deletionRequested === true) {
            return;
        }

        const uid = event.params.uid;
        logger.info("Account deletion requested", { uid: uid.slice(0, 8) });

        // Idempotency check
        if (newData.deletionStatus === "PROCESSING" || newData.deletionStatus === "COMPLETED") {
            logger.info("Deletion already in progress or completed", { uid: uid.slice(0, 8) });
            return;
        }

        try {
            // 1. Mark as PROCESSING
            await snapshot.after.ref.update({
                deletionStatus: "PROCESSING",
                deletionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // 2. Recursively delete all subcollections and the user document
            logger.info("Starting recursive delete", { uid: uid.slice(0, 8) });
            await db.recursiveDelete(snapshot.after.ref);

            // 3. Delete Firebase Auth user
            try {
                await auth.deleteUser(uid);
                logger.info("Auth user deleted", { uid: uid.slice(0, 8) });
            } catch (authError: any) {
                if (authError.code === "auth/user-not-found") {
                    logger.info("Auth user already deleted", { uid: uid.slice(0, 8) });
                } else {
                    throw authError;
                }
            }

            logger.info("Account deletion completed", { uid: uid.slice(0, 8) });
        } catch (error: any) {
            logger.error("Account deletion failed", { uid: uid.slice(0, 8), error: error.message });

            // Write failure state only if document still exists
            const docSnap = await snapshot.after.ref.get();
            if (docSnap.exists) {
                await snapshot.after.ref.update({
                    deletionStatus: "FAILED",
                    deletionError: error.message || "Unknown error",
                });
            }
        }
    }
);
