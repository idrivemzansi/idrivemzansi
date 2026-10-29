import { z } from "zod";

const text = z.string().trim().min(1).max(5000);
const strings = z.array(text).max(100);
const object = z.record(z.unknown());
const list = z.array(z.unknown()).max(500);
const input = (shape: z.ZodRawShape) => z.object(shape).passthrough();

export const aiInputs = {
  bio: input({ instructor_profile: object }),
  "generate-lesson-plan": input({ learner_profile: object, k53_test_history: list, progress: object, goals: strings }),
  "student-assessment": input({ lesson_plans: list, exercise_completions: list, instructor_feedback: list }),
  "instructor-coach": input({ bookings: list, ratings: list, reviews: list, lesson_plans: list, student_progress: list }),
  "k53-questions": input({ test_type: text, difficulty: z.enum(["easy", "medium", "hard", "adaptive"]), count: z.number().int().min(1).max(20) }),
  "k53-analysis": input({ questions: z.array(z.object({ question: text, options: z.array(text).length(4), correct_index: z.number().int().min(0).max(3), explanation: text, category: text })), learner_answers: z.array(z.number().int().min(0).max(3)) }),
  "smart-recommendations": input({ learner_preferences: object, active_instructors: z.array(object).max(500) }),
  "marketing-content": input({ instructor_profile: object, city: text, reviews: list }),
  "availability-optimizer": input({ booking_history: list, cancellations: list, current_availability: object }),
  chatbot: input({ message: text.max(4000), user_context: object, page_context: object, chat_history: z.array(object).max(30) }),
  // Public API accepts only a private S3 URL; server code resolves and reads the object.
  "document-verify": input({ document_type: z.enum(["identity", "learner_licence", "instructor_licence", "vehicle_licence", "instructor_certificate", "vehicle_roadworthy", "police_clearance", "vehicle_insurance", "professional_liability_insurance", "other"]), s3_url: z.string().min(1).max(2048) }),
  "welcome-message": input({ profile: object.optional(), learner_profile: object.optional(), instructor_profile: object.optional(), onboarding_data: object }).refine(v => Boolean(v.profile || v.learner_profile || v.instructor_profile), "Provide a learner or instructor profile"),
  "pricing-suggestion": input({ city: text, lesson_types: strings, experience: z.number().min(0).max(80), competitor_rates: z.array(z.number().min(0).max(10000)).max(100) }),
  "review-sentiment": input({ comments:text, went_well:text.optional(), improvements:text.optional() }),
} as const;

const boundedScore = z.number().min(0).max(100);
const nonemptyList = z.array(text).min(1).max(40);
export const aiOutputs = {
  bio: z.object({ bio: text }),
  "generate-lesson-plan": z.object({ topics: nonemptyList, exercises: nonemptyList, focus_areas: nonemptyList, teaching_strategy: text, homework: text }),
  "student-assessment": z.object({ skill_level: text, strengths: strings, improvement_areas: strings, test_readiness_pct: boundedScore, goals: strings }),
  "instructor-coach": z.object({ performance_score: boundedScore, strategies: strings, misconceptions: strings, curriculum_adjustments: strings, support_messages: strings, quick_wins: strings }),
  "k53-questions": z.array(z.object({ question: text, options: z.array(text).length(4), correct_index: z.number().int().min(0).max(3), explanation: text, category: text })).min(1).max(20),
  "k53-analysis": z.object({ score: boundedScore, weak_categories: strings, improvement_areas: strings, next_difficulty: z.enum(["easy", "medium", "hard"]), study_plan: text }),
  "smart-recommendations": z.array(z.object({ instructor_id: text, match_score: boundedScore, reasons: strings, best_suited_for: text })).max(5),
  "marketing-content": z.object({ facebook_posts: strings, instagram_posts: strings, email_templates: z.array(z.object({ subject: text, body: text })).max(20), ad_campaigns: z.array(z.object({ headline: text, description: text, call_to_action: text })).max(20), posting_schedule: object }),
  "availability-optimizer": z.object({ effectiveness_score: boundedScore, optimal_slots: z.array(z.object({ starts_at: text, confidence_score: boundedScore, reason: text })).max(50), risk_slots: strings, peak_opportunities: strings, recommended_schedule: object }),
  chatbot: z.object({ reply: text, suggested_questions: strings }),
  "document-verify": z.object({ authenticity_score: boundedScore, quality_score: boundedScore, extracted_data: object, name_match: z.boolean(), red_flags: strings, recommendation: z.enum(["approve", "manual_review", "reject"]) }),
  "welcome-message": z.object({ subject: text, body: text, quick_tips: strings, insights: strings }),
  "pricing-suggestion": z.object({ conservative: z.number().min(0), recommended: z.number().min(0), premium: z.number().min(0), reasoning: text }).refine(v => v.conservative <= v.recommended && v.recommended <= v.premium, "Pricing tiers must be ascending"),
  "review-sentiment": z.object({ sentiment:z.enum(["positive","mixed","negative"]),themes:strings,moderation_flag:z.boolean(),moderation_reason:text.optional() }),
} as const;

export type AiTask = keyof typeof aiInputs;
