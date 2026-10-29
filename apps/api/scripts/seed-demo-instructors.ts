/**
 * Seeds a handful of demo instructor records so the marketplace, instructor
 * profile pages and the homepage pricing section have real prices to show.
 *
 * Records are written to the instructors table the API uses (same .env), are
 * marked verification_status: "active" so they appear in public listings, and
 * only ever touches demo instructor ids it created itself (rows carry demo: true).
 * Re-running refreshes those demo rows to match this file.
 *
 * Run from the api workspace so dotenv picks up apps/api/.env:
 *   cd apps/api && npx tsx scripts/seed-demo-instructors.ts
 */
import "dotenv/config";
import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docDb, tables } from "../src/services/dynamodb";

type DemoInstructor = Record<string, unknown>;

const CAR_PHOTOS = [
  "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=1000&q=90",
  "https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1000&q=90",
  "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1000&q=90",
];

const instructors: DemoInstructor[] = [
  {
    user_id: "demo-instructor-1",
    full_name: "Thandi Mokoena",
    city: "Johannesburg",
    suburbs_covered: ["Sandton", "Rosebank", "Bryanston", "Randburg"],
    bio: "Patient, structured instructor with 8 years behind the wheel. I specialise in nervous first-timers and K53 test prep, and I keep every lesson calm and practical.",
    experience_years: 8,
    languages: ["English", "isiZulu", "Setswana"],
    primary_approach: "Calm, structured progression",
    secondary_approaches: ["Mock test runs", "Anxiety-friendly pacing"],
    philosophy: "Confidence comes from repetition, not pressure.",
    student_types: ["Nervous beginners", "Test retakes", "Teenagers"],
    unique_techniques: ["Parallel parking broken into three repeatable steps"],
    lesson_types: ["B", "EB", "K53 Test Prep"],
    transmission: "manual",
    vehicle_make: "Toyota",
    vehicle_model: "Yaris",
    vehicle_photos: CAR_PHOTOS,
    hourly_rate: 500,
    teaching_style: { pace: "relaxed", focus: "confidence" },
    specializations: ["Nervous drivers", "K53 preparation"],
    certifications: ["Department of Transport Driving Instructor"],
    profile_photo_url: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=200&q=85",
    latitude: -26.1076,
    longitude: 28.0567,
    avg_rating: 4.9,
    rating: 4.9,
    review_count: 132,
    own_vehicle_allowed: true,
    own_vehicle_discount_percent: 20,
    availability_windows: [
      { day: "monday", start: "08:00", end: "17:00" },
      { day: "tuesday", start: "08:00", end: "17:00" },
      { day: "wednesday", start: "08:00", end: "17:00" },
      { day: "thursday", start: "08:00", end: "17:00" },
      { day: "saturday", start: "08:00", end: "13:00" },
    ],
    lesson_packages: [
      { name: "Starter 5", lesson_count: 5, price: 2300, lesson_type: "B" },
      { name: "Road Ready 10", lesson_count: 10, price: 4200, lesson_type: "B" },
      { name: "K53 Pass 20", lesson_count: 20, price: 7800, lesson_type: "K53 Test Prep" },
    ],
    membership_tier: "premier",
    membership_expiry: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    verification_status: "active",
    onboarding_complete: true,
    profile_completeness: 100,
    created_at: new Date().toISOString(),
  },
  {
    user_id: "demo-instructor-2",
    full_name: "Sipho Dlamini",
    city: "Cape Town",
    suburbs_covered: ["Sea Point", "Observatory", "Woodstock", "Green Point"],
    bio: "Automatic specialist working the Atlantic seaboard. Compact hatchback, easy parking, and lessons built around your schedule.",
    experience_years: 3,
    languages: ["English", "isiXhosa"],
    primary_approach: "Relaxed city driving",
    secondary_approaches: ["Route-based learning"],
    philosophy: "Learn on the roads you actually drive.",
    student_types: ["Adult beginners", "International licence conversions"],
    unique_techniques: ["Lesson routes mirrored from your daily commute"],
    lesson_types: ["A", "B"],
    transmission: "automatic",
    vehicle_make: "Volkswagen",
    vehicle_model: "Polo",
    vehicle_photos: CAR_PHOTOS,
    hourly_rate: 350,
    teaching_style: { pace: "steady", focus: "city driving" },
    specializations: ["Automatic transmissions", "City driving"],
    certifications: ["Department of Transport Driving Instructor"],
    profile_photo_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=85",
    latitude: -33.9273,
    longitude: 18.4161,
    avg_rating: 4.6,
    rating: 4.6,
    review_count: 41,
    own_vehicle_allowed: false,
    availability_windows: [
      { day: "monday", start: "09:00", end: "18:00" },
      { day: "wednesday", start: "09:00", end: "18:00" },
      { day: "friday", start: "09:00", end: "18:00" },
      { day: "saturday", start: "09:00", end: "14:00" },
    ],
    lesson_packages: [{ name: "Automatic Basics 6", lesson_count: 6, price: 1950, lesson_type: "A" }],
    verification_status: "active",
    onboarding_complete: true,
    profile_completeness: 100,
    created_at: new Date().toISOString(),
  },
  {
    user_id: "demo-instructor-3",
    full_name: "Naledi Khumalo",
    city: "Pretoria",
    suburbs_covered: ["Menlo Park", "Garsfontein", "Brooklyn"],
    bio: "Weekend and after-hours lessons for students and working professionals. Manual and automatic, your choice of vehicle.",
    experience_years: 5,
    languages: ["English", "isiZulu", "Afrikaans"],
    primary_approach: "Flexible scheduling",
    secondary_approaches: ["Weekend intensives"],
    philosophy: "Your licence should fit around your life, not the other way round.",
    student_types: ["Students", "Shift workers"],
    unique_techniques: ["Two-hour weekend intensive blocks"],
    lesson_types: ["B", "EB", "Defensive Driving"],
    transmission: "both",
    vehicle_make: "Suzuki",
    vehicle_model: "Swift",
    vehicle_photos: CAR_PHOTOS,
    hourly_rate: 420,
    teaching_style: { pace: "flexible", focus: "roadcraft" },
    specializations: ["Weekend lessons", "Defensive driving"],
    certifications: ["Department of Transport Driving Instructor"],
    profile_photo_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=85",
    latitude: -25.7747,
    longitude: 28.2314,
    avg_rating: 5,
    rating: 5,
    review_count: 12,
    own_vehicle_allowed: true,
    own_vehicle_discount_percent: 15,
    availability_windows: [
      { day: "tuesday", start: "15:00", end: "20:00" },
      { day: "thursday", start: "15:00", end: "20:00" },
      { day: "saturday", start: "07:00", end: "16:00" },
      { day: "sunday", start: "08:00", end: "14:00" },
    ],
    lesson_packages: [],
    verification_status: "active",
    onboarding_complete: true,
    profile_completeness: 100,
    created_at: new Date().toISOString(),
  },
  {
    user_id: "demo-instructor-4",
    full_name: "Bongani Nkosi",
    city: "Durban",
    suburbs_covered: ["Umhlanga", "Berea", "Springfield", "Pinetown"],
    bio: "Ten years teaching licence candidates along the north coast, with a strong pass rate on first attempt.",
    experience_years: 10,
    languages: ["English", "isiZulu"],
    primary_approach: "Test-focused coaching",
    secondary_approaches: ["Mock DLTC runs"],
    philosophy: "Practise the test until it is boring.",
    student_types: ["Test retakes", "Nervous beginners"],
    unique_techniques: ["Full mock test at the exact DLTC route"],
    lesson_types: ["B", "EB", "K53 Test Prep", "Traffic Department Pass Out Test (3h)"],
    transmission: "manual",
    vehicle_make: "Ford",
    vehicle_model: "Fiesta",
    vehicle_photos: CAR_PHOTOS,
    hourly_rate: 450,
    teaching_style: { pace: "structured", focus: "test preparation" },
    specializations: ["K53 test preparation", "First-time pass coaching"],
    certifications: ["Department of Transport Driving Instructor", "K53 Assessor"],
    profile_photo_url: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=200&q=85",
    latitude: -29.8587,
    longitude: 31.0218,
    avg_rating: 4.8,
    rating: 4.8,
    review_count: 87,
    own_vehicle_allowed: true,
    own_vehicle_discount_percent: 10,
    availability_windows: [
      { day: "monday", start: "07:00", end: "16:00" },
      { day: "tuesday", start: "07:00", end: "16:00" },
      { day: "wednesday", start: "07:00", end: "16:00" },
      { day: "thursday", start: "07:00", end: "16:00" },
      { day: "friday", start: "07:00", end: "16:00" },
    ],
    lesson_packages: [
      { name: "First Timer 8", lesson_count: 8, price: 3300, lesson_type: "B" },
      { name: "Retake Rescue 4", lesson_count: 4, price: 1700, lesson_type: "K53 Test Prep" },
    ],
    verification_status: "active",
    onboarding_complete: true,
    profile_completeness: 100,
    created_at: new Date().toISOString(),
  },
  {
    user_id: "demo-instructor-5",
    full_name: "Ayesha Patel",
    city: "Bloemfontein",
    suburbs_covered: ["Universitas", "Langenhoven Park", "Bethelsdorp"],
    bio: "Automatic-only instructor for learners who want a calm, traffic-free start before moving onto bigger routes.",
    experience_years: 6,
    languages: ["English", "Afrikaans", "isiZulu"],
    primary_approach: "Quiet-road fundamentals",
    secondary_approaches: ["Highway confidence modules"],
    philosophy: "Master the quiet roads first, the busy ones follow.",
    student_types: ["Teenagers", "Adult beginners"],
    unique_techniques: ["Progressive highway introduction from lesson six"],
    lesson_types: ["A", "B"],
    transmission: "automatic",
    vehicle_make: "Hyundai",
    vehicle_model: "i20",
    vehicle_photos: CAR_PHOTOS,
    hourly_rate: 380,
    teaching_style: { pace: "gentle", focus: " fundamentals" },
    specializations: ["Automatic transmissions", "Highway confidence"],
    certifications: ["Department of Transport Driving Instructor"],
    profile_photo_url: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=85",
    latitude: -29.0852,
    longitude: 26.1596,
    avg_rating: 4.7,
    rating: 4.7,
    review_count: 29,
    own_vehicle_allowed: false,
    availability_windows: [
      { day: "monday", start: "09:00", end: "17:00" },
      { day: "tuesday", start: "09:00", end: "17:00" },
      { day: "thursday", start: "09:00", end: "17:00" },
      { day: "saturday", start: "08:00", end: "12:00" },
    ],
    lesson_packages: [{ name: "Confidence 5", lesson_count: 5, price: 1750, lesson_type: "A" }],
    verification_status: "active",
    onboarding_complete: true,
    profile_completeness: 100,
    created_at: new Date().toISOString(),
  },
];

async function main() {
  console.log(`Seeding ${instructors.length} demo instructors into ${tables.instructors}`);

  const existing: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await docDb.send(new ScanCommand({ TableName: tables.instructors, ExclusiveStartKey: exclusiveStartKey }));
    existing.push(...(page.Items ?? []));
    exclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  const demoIds = new Set(instructors.map(row => String(row.user_id)));
  const conflicts = existing.filter(row => demoIds.has(String(row.user_id)) && row.demo !== true);
  if (conflicts.length) {
    console.error(
      `Refusing to overwrite ${conflicts.length} existing non-demo record(s): ${conflicts
        .map(row => String(row.user_id))
        .join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  for (const instructor of instructors) {
    const isUpdate = existing.some(row => String(row.user_id) === String(instructor.user_id));
    await docDb.send(new PutCommand({ TableName: tables.instructors, Item: { ...instructor, demo: true } }));
    console.log(`${isUpdate ? "update" : "put   "} ${instructor.user_id} (${instructor.full_name}) — ${instructor.hourly_rate} ZAR/hr`);
  }

  const totals = instructors.map(row => {
    const packages = (row.lesson_packages as Array<{ lesson_count: number; price: number }>) ?? [];
    return `${String(row.full_name)}: R${row.hourly_rate}/hr, ${packages.length} package(s)`;
  });
  console.log(`\nDone. ${totals.join("\n")}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
