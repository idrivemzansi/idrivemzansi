"""Create a private bucket for learner identity/license and instructor documents."""
import json
import os
import subprocess

REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "af-south-1"))
ACCOUNT_ID = os.getenv("AWS_ACCOUNT_ID", "619924817943")
BUCKET = os.getenv("S3_BUCKET", "mzansidrive-private-" + ACCOUNT_ID)


def aws(*args):
    return subprocess.run(["aws", *args, "--region", REGION], check=True, capture_output=True, text=True)


def main():
    present = subprocess.run(["aws", "s3api", "head-bucket", "--bucket", BUCKET], capture_output=True)
    if present.returncode != 0:
        aws("s3api", "create-bucket", "--bucket", BUCKET, "--create-bucket-configuration", "LocationConstraint=" + REGION)
        print("Created bucket " + BUCKET, flush=True)
    else:
        print("Using bucket " + BUCKET, flush=True)
    aws("s3api", "put-public-access-block", "--bucket", BUCKET, "--public-access-block-configuration", "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true")
    encryption = {"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}, "BucketKeyEnabled": True}]}
    with open("infra/s3/encryption.json", "w", encoding="utf-8") as target:
        json.dump(encryption, target)
    aws("s3api", "put-bucket-encryption", "--bucket", BUCKET, "--server-side-encryption-configuration", "file://infra/s3/encryption.json")
    os.remove("infra/s3/encryption.json")
    aws("s3api", "put-bucket-ownership-controls", "--bucket", BUCKET, "--ownership-controls", "Rules=[{ObjectOwnership=BucketOwnerEnforced}]")
    cors = {"CORSRules": [{"AllowedOrigins": ["http://localhost:3000", "https://www.mzansidrive.co.za"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3000}]}
    with open("infra/s3/cors.json", "w", encoding="utf-8") as target:
        json.dump(cors, target)
    aws("s3api", "put-bucket-cors", "--bucket", BUCKET, "--cors-configuration", "file://infra/s3/cors.json")
    os.remove("infra/s3/cors.json")
    policy = {"Version": "2012-10-17", "Statement": [{"Sid": "DenyInsecureTransport", "Effect": "Deny", "Principal": "*", "Action": "s3:*", "Resource": ["arn:aws:s3:::" + BUCKET, "arn:aws:s3:::" + BUCKET + "/*"], "Condition": {"Bool": {"aws:SecureTransport": "false"}}}]}
    with open("infra/s3/policy.json", "w", encoding="utf-8") as target:
        json.dump(policy, target)
    aws("s3api", "put-bucket-policy", "--bucket", BUCKET, "--policy", "file://infra/s3/policy.json")
    os.remove("infra/s3/policy.json")
    print(json.dumps({"region": REGION, "bucket": BUCKET, "publicAccess": "blocked", "encryption": "AES256"}, indent=2))


if __name__ == "__main__":
    main()
