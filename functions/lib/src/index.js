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
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUserStatusChanged = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
exports.onUserStatusChanged = (0, firestore_1.onDocumentUpdated)({
    document: "users/{uid}",
    timeoutSeconds: 540,
    memory: "1GiB",
}, async (event) => {
    var _a, _b;
    const newData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after.data();
    const previousData = (_b = event.data) === null || _b === void 0 ? void 0 : _b.before.data();
    if (!newData || !previousData)
        return;
    // Only act when deletionRequested transitions from false → true
    if (newData.deletionRequested !== true || previousData.deletionRequested === true) {
        return;
    }
    const uid = event.params.uid;
    firebase_functions_1.logger.info("Account deletion requested", { uid: uid.slice(0, 8) });
    // Idempotency check
    if (newData.deletionStatus === "PROCESSING" || newData.deletionStatus === "COMPLETED") {
        firebase_functions_1.logger.info("Deletion already in progress or completed", { uid: uid.slice(0, 8) });
        return;
    }
    try {
        // 1. Mark as PROCESSING
        await event.data.after.ref.update({
            deletionStatus: "PROCESSING",
            deletionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // 2. Recursively delete all subcollections and documents
        firebase_functions_1.logger.info("Starting recursive delete", { uid: uid.slice(0, 8) });
        await db.recursiveDelete(event.data.after.ref);
        // 3. Delete Firebase Auth user
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
        firebase_functions_1.logger.error("Account deletion failed", { uid: uid.slice(0, 8), error: error.message });
        // Write failure state only if document still exists
        const docSnap = await event.data.after.ref.get();
        if (docSnap.exists) {
            await event.data.after.ref.update({
                deletionStatus: "FAILED",
                deletionError: error.message || "Unknown error",
            });
        }
    }
});
//# sourceMappingURL=index.js.map