import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "af-south-1" });
export const docDb = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const prefix = process.env.DYNAMODB_TABLE_PREFIX ?? "mzansidrive-";
export const tables = {
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
} as const;
