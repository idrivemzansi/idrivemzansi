"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiOutputs = exports.aiInputs = void 0;
const zod_1 = require("zod");
const text = zod_1.z.string().trim().min(1).max(5000);
const strings = zod_1.z.array(text).max(100);
const object = zod_1.z.record(zod_1.z.unknown());
const list = zod_1.z.array(zod_1.z.unknown()).max(500);
const input = (shape) => zod_1.z.object(shape).passthrough();
exports.aiInputs = {
    bio: input({ instructor_profile: object }),
    "generate-lesson-plan": input({ learner_profile: object, k53_test_history: list, progress: object, goals: strings }),
    "student-assessment": input({ lesson_plans: list, exercise_completions: list, instructor_feedback: list }),
    "instructor-coach": input({ bookings: list, ratings: list, reviews: list, lesson_plans: list, student_progress: list }),
    "k53-questions": input({ test_type: text, difficulty: zod_1.z.enum(["easy", "medium", "hard", "adaptive"]), count: zod_1.z.number().int().min(1).max(20) }),
    "k53-analysis": input({ questions: zod_1.z.array(zod_1.z.object({ question: text, options: zod_1.z.array(text).length(4), correct_index: zod_1.z.number().int().min(0).max(3), explanation: text, category: text })), learner_answers: zod_1.z.array(zod_1.z.number().int().min(0).max(3)) }),
    "smart-recommendations": input({ learner_preferences: object, active_instructors: zod_1.z.array(object).max(500) }),
    "marketing-content": input({ instructor_profile: object, city: text, reviews: list }),
    "availability-optimizer": input({ booking_history: list, cancellations: list, current_availability: object }),
    chatbot: input({ message: text.max(4000), user_context: object, page_context: object, chat_history: zod_1.z.array(object).max(30) }),
    // Public API accepts only a private S3 URL; server code resolves and reads the object.
    "document-verify": input({ document_type: zod_1.z.enum(["identity", "learner_licence", "instructor_licence", "vehicle_licence", "instructor_certificate", "vehicle_roadworthy", "police_clearance", "vehicle_insurance", "professional_liability_insurance", "other"]), s3_url: zod_1.z.string().min(1).max(2048) }),
    "welcome-message": input({ profile: object.optional(), learner_profile: object.optional(), instructor_profile: object.optional(), onboarding_data: object }).refine(v => Boolean(v.profile || v.learner_profile || v.instructor_profile), "Provide a learner or instructor profile"),
    "pricing-suggestion": input({ city: text, lesson_types: strings, experience: zod_1.z.number().min(0).max(80), competitor_rates: zod_1.z.array(zod_1.z.number().min(0).max(10000)).max(100) }),
    "review-sentiment": input({ comments: text, went_well: text.optional(), improvements: text.optional() }),
};
const boundedScore = zod_1.z.number().min(0).max(100);
const nonemptyList = zod_1.z.array(text).min(1).max(40);
exports.aiOutputs = {
    bio: zod_1.z.object({ bio: text }),
    "generate-lesson-plan": zod_1.z.object({ topics: nonemptyList, exercises: nonemptyList, focus_areas: nonemptyList, teaching_strategy: text, homework: text }),
    "student-assessment": zod_1.z.object({ skill_level: text, strengths: strings, improvement_areas: strings, test_readiness_pct: boundedScore, goals: strings }),
    "instructor-coach": zod_1.z.object({ performance_score: boundedScore, strategies: strings, misconceptions: strings, curriculum_adjustments: strings, support_messages: strings, quick_wins: strings }),
    "k53-questions": zod_1.z.array(zod_1.z.object({ question: text, options: zod_1.z.array(text).length(4), correct_index: zod_1.z.number().int().min(0).max(3), explanation: text, category: text })).min(1).max(20),
    "k53-analysis": zod_1.z.object({ score: boundedScore, weak_categories: strings, improvement_areas: strings, next_difficulty: zod_1.z.enum(["easy", "medium", "hard"]), study_plan: text }),
    "smart-recommendations": zod_1.z.array(zod_1.z.object({ instructor_id: text, match_score: boundedScore, reasons: strings, best_suited_for: text })).max(5),
    "marketing-content": zod_1.z.object({ facebook_posts: strings, instagram_posts: strings, email_templates: zod_1.z.array(zod_1.z.object({ subject: text, body: text })).max(20), ad_campaigns: zod_1.z.array(zod_1.z.object({ headline: text, description: text, call_to_action: text })).max(20), posting_schedule: object }),
    "availability-optimizer": zod_1.z.object({ effectiveness_score: boundedScore, optimal_slots: zod_1.z.array(zod_1.z.object({ starts_at: text, confidence_score: boundedScore, reason: text })).max(50), risk_slots: strings, peak_opportunities: strings, recommended_schedule: object }),
    chatbot: zod_1.z.object({ reply: text, suggested_questions: strings }),
    "document-verify": zod_1.z.object({ authenticity_score: boundedScore, quality_score: boundedScore, extracted_data: object, name_match: zod_1.z.boolean(), red_flags: strings, recommendation: zod_1.z.enum(["approve", "manual_review", "reject"]) }),
    "welcome-message": zod_1.z.object({ subject: text, body: text, quick_tips: strings, insights: strings }),
    "pricing-suggestion": zod_1.z.object({ conservative: zod_1.z.number().min(0), recommended: zod_1.z.number().min(0), premium: zod_1.z.number().min(0), reasoning: text }).refine(v => v.conservative <= v.recommended && v.recommended <= v.premium, "Pricing tiers must be ascending"),
    "review-sentiment": zod_1.z.object({ sentiment: zod_1.z.enum(["positive", "mixed", "negative"]), themes: strings, moderation_flag: zod_1.z.boolean(), moderation_reason: text.optional() }),
};
