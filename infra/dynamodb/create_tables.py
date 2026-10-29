"""Create the MzansiDrive DynamoDB tables in the selected AWS region.

Only key attributes are declared: DynamoDB is schemaless for all other attributes.
Tables use on-demand billing. Existing tables are left untouched.
"""
import json
import os
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

PREFIX = os.getenv("MZANSIDRIVE_TABLE_PREFIX", "mzansidrive-")
REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "af-south-1"))


def gsi(name, partition, sort=None):
    keys = [{"AttributeName": partition, "KeyType": "HASH"}]
    if sort:
        keys.append({"AttributeName": sort, "KeyType": "RANGE"})
    return {"IndexName": name, "KeySchema": keys, "Projection": {"ProjectionType": "ALL"}}


SPECS = {
    "users": ("id", [gsi("EmailLookup", "email")]),
    "learners": ("user_id", [gsi("ReferralCodeLookup", "referral_code")]),
    "instructors": ("user_id", [gsi("CityListings", "city", "user_id"), gsi("VerificationQueue", "verification_status", "user_id"), gsi("ReferralCodeLookup", "referral_code")]),
    "companies": ("id", [gsi("RegistrationLookup", "registration_number")]),
    "bookings": ("id", [gsi("LearnerBookings", "learner_id", "date"), gsi("InstructorBookings", "instructor_id", "date"), gsi("CompanyBookings", "company_id", "date"), gsi("StatusBookings", "status", "date")]),
    "booking-locks": ("id", []),
    "payment-transactions": ("id", [gsi("UserTransactions", "user_id", "created_at")]),
    "messages": ("id", [gsi("BookingMessages", "booking_id", "created_at"), gsi("ReceiverMessages", "receiver_id", "created_at")]),
    "reviews": ("id", [gsi("InstructorReviews", "instructor_id", "booking_id"), gsi("LearnerReviews", "learner_id", "booking_id"), gsi("BookingReviewLookup", "booking_id")]),
    "learner-reviews": ("id", [gsi("LearnerFeedback", "learner_id", "booking_id"), gsi("InstructorFeedback", "instructor_id", "booking_id")]),
    "lesson-plans": ("id", [gsi("LearnerLessonPlans", "learner_id", "booking_id"), gsi("InstructorLessonPlans", "instructor_id", "booking_id"), gsi("BookingPlanLookup", "booking_id")]),
    "student-progress": ("id", [gsi("LearnerProgress", "learner_id", "id"), gsi("InstructorProgress", "instructor_id", "id")]),
    "k53-test-results": ("id", [gsi("LearnerTestHistory", "learner_id", "created_at"), gsi("LearnerTestTypes", "learner_id", "test_type")]),
    "drive-logbook": ("id", [gsi("LearnerLogbook", "learner_id", "booking_id"), gsi("InstructorLogbook", "instructor_id", "booking_id"), gsi("BookingLogbookLookup", "booking_id")]),
    "disputes": ("id", [gsi("BookingDisputes", "booking_id"), gsi("DisputeQueue", "status", "id")]),
    "notifications": ("id", [gsi("UserNotifications", "user_id", "created_at")]),
    "achievements": ("id", [gsi("InstructorAchievements", "instructor_id", "unlocked_at")]),
    "instructor-stats": ("id", [gsi("InstructorStatsLookup", "instructor_id")]),
    "ad-campaigns": ("id", [gsi("InstructorCampaigns", "instructor_id", "platform")]),
    "payouts": ("id", [gsi("InstructorPayouts", "instructor_id", "created_at"), gsi("PayoutQueue", "status", "created_at")]),
    "referrals": ("id", [gsi("ReferrerHistory", "referrer_id", "id"), gsi("ReferredUserLookup", "referred_id")]),
    "video-lessons": ("id", [gsi("InstructorVideos", "instructor_id", "title"), gsi("VideoTypeLookup", "type", "title")]),
    "enatis-slots": ("id", [gsi("SlotsByCentreDate", "test_centre", "available_date"), gsi("SlotsByProvinceDate", "province", "available_date"), gsi("LearnerSlots", "learner_id", "available_date")]),
}


def run(args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True)


def params_for(table_name, partition_key, indexes):
    key_names = {partition_key}
    for index in indexes:
        key_names.update(key["AttributeName"] for key in index["KeySchema"])
    definitions = [{"AttributeName": name, "AttributeType": "S"} for name in sorted(key_names)]
    params = {
        "TableName": table_name,
        "AttributeDefinitions": definitions,
        "KeySchema": [{"AttributeName": partition_key, "KeyType": "HASH"}],
        "BillingMode": "PAY_PER_REQUEST",
        "Tags": [{"Key": "Project", "Value": "MzansiDrive"}, {"Key": "ManagedBy", "Value": "infra/dynamodb/create_tables.py"}],
    }
    if indexes:
        params["GlobalSecondaryIndexes"] = indexes
    return params


def create_one(table_name, partition_key, indexes):
    params = params_for(table_name, partition_key, indexes)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False) as temp:
            json.dump(params, temp)
            temp_path = temp.name
        run(["aws", "dynamodb", "create-table", "--region", REGION, "--cli-input-json", "file://" + temp_path])
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
    return table_name


def wait_until_ready(table_name, expected_indexes):
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        description = json.loads(run(["aws", "dynamodb", "describe-table", "--region", REGION, "--table-name", table_name, "--output", "json"]).stdout)["Table"]
        indexes = {item["IndexName"]: item["IndexStatus"] for item in description.get("GlobalSecondaryIndexes", [])}
        if description["TableStatus"] == "ACTIVE" and all(indexes.get(name) == "ACTIVE" for name in expected_indexes):
            print("ACTIVE " + table_name, flush=True)
            return table_name
        time.sleep(5)
    raise TimeoutError("Timed out waiting for table/indexes: " + table_name)


def main():
    existing = set()
    response = json.loads(run(["aws", "dynamodb", "list-tables", "--region", REGION, "--output", "json"]).stdout)
    existing.update(response.get("TableNames", []))
    created, skipped, pending = [], [], []
    for suffix, (partition_key, indexes) in SPECS.items():
        table_name = PREFIX + suffix
        if table_name in existing:
            skipped.append(table_name)
        else:
            pending.append((table_name, partition_key, indexes))

    # Create in bounded batches; then wait for each table and every requested index to be active.
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(create_one, name, key, indexes): name for name, key, indexes in pending}
        for future in as_completed(futures):
            created.append(future.result())
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {
            pool.submit(wait_until_ready, PREFIX + suffix, [index["IndexName"] for index in indexes]): PREFIX + suffix
            for suffix, (_key, indexes) in SPECS.items()
        }
        for future in as_completed(futures):
            future.result()

    lock_table = PREFIX + "booking-locks"
    ttl = json.loads(run(["aws", "dynamodb", "describe-time-to-live", "--region", REGION, "--table-name", lock_table, "--output", "json"]).stdout).get("TimeToLiveDescription", {})
    if ttl.get("TimeToLiveStatus") not in {"ENABLED", "ENABLING"}:
        run(["aws", "dynamodb", "update-time-to-live", "--region", REGION, "--table-name", lock_table, "--time-to-live-specification", "Enabled=true,AttributeName=expires_at"])

    print(json.dumps({"region": REGION, "created": sorted(created), "already_existed": sorted(skipped)}, indent=2), flush=True)


if __name__ == "__main__":
    main()
