"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tables = exports.docDb = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION ?? "af-south-1" });
exports.docDb = lib_dynamodb_1.DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const prefix = process.env.DYNAMODB_TABLE_PREFIX ?? "mzansidrive-";
exports.tables = {
    users: prefix + "users",
    learners: prefix + "learners",
    instructors: prefix + "instructors",
    companies: prefix + "companies",
    bookings: prefix + "bookings",
    bookingLocks: prefix + "booking-locks",
    paymentTransactions: prefix + "payment-transactions",
    messages: prefix + "messages",
    reviews: prefix + "reviews",
    learnerReviews: prefix + "learner-reviews",
    lessonPlans: prefix + "lesson-plans",
    studentProgress: prefix + "student-progress",
    k53TestResults: prefix + "k53-test-results",
    driveLogbook: prefix + "drive-logbook",
    disputes: prefix + "disputes",
    notifications: prefix + "notifications",
    achievements: prefix + "achievements",
    instructorStats: prefix + "instructor-stats",
    adCampaigns: prefix + "ad-campaigns",
    payouts: prefix + "payouts",
    referrals: prefix + "referrals",
    videoLessons: prefix + "video-lessons",
    enatisSlots: prefix + "enatis-slots",
};
