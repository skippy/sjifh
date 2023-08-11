#!/bin/zsh
set -e  # fail script on error
# set -x  # show cmds run within this script

local DEFAULT_GCLOUD_PROJECT='sjifh-378705'
local DEFAULT_GCLOUD_REGION='us-west1'

local DOCKER_IMAGE_NAME='sjifh'
local FIREBASE_DATABASE_NAME='sjifh-shopify-orders'

local shopify_update_schedule='*/5 * * * *'
# local job_name='check-cardholders-refill'
local service_acct_name='lfm-shopify'
local stripe_api_key_read_name='STRIPE_ISSUING_READ_API_KEY'
local stripe_api_key_write_name='STRIPE_ISSUING_WRITE'
local stripe_api_key_cardholder_setup_name='STRIPE_AUTH_WEBHOOK_CARDHOLDER_SETUP_SECRET'
local stripe_api_key_auth_webhook_name='STRIPE_AUTH_WEBHOOK_SECRET'


# us-west1
# sjfood

# read -e 'Enter gcloud project' gcloud_project
vared -p "Enter gcloud project [${DEFAULT_GCLOUD_PROJECT}]: " -c gcloud_project
: ${gcloud_project:=$DEFAULT_GCLOUD_PROJECT}
vared -p "Enter gcloud region [${DEFAULT_GCLOUD_REGION}]: " -c gcloud_region
# read -e 'Enter gcloud region' gcloud_region
: ${gcloud_region:=$DEFAULT_GCLOUD_REGION}
local service_acct=`gcloud iam service-accounts list --project ${gcloud_project} --filter="${service_acct_name}" --format="json" | jq -r '.[0].email'`

echo "\n"


echo '---- setting up firebase'
gcloud services enable firestore.googleapis.com
if gcloud firestore databases describe 2>/dev/null; then
  # nothing to do
else
  gcloud firestore databases create --location="${gcloud_region}"
fi
echo "\n"

echo '---- building and pushing docker img'
local docker_img_path="gcr.io/${gcloud_project}/${DOCKER_IMAGE_NAME}"
gcloud auth configure-docker 2>/dev/null
# we need to specify platform; if it is built on ARM, it won't work on gcloud
docker build --platform=linux/amd64 -t "${docker_img_path}" .
docker push "${docker_img_path}"
echo "\n"

# gcloud_project



# echo "gcloud run jobs deploy update-shopify-from-lfm \
#   --image "${docker_img_path}" \
#   --region ${gcloud_region} \
#   --command 'update-shopify -vvv' \
#   --set-secrets 'LFM_PASSWORD=LFM_PASSWORD:latest' \
#   --set-secrets 'LFM_USERNAME=LFM_USERNAME:latest' \
#   --set-secrets 'SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN:latest'" &


gcloud run jobs deploy update-shopify-from-lfm \
  --image "${docker_img_path}" \
  --region "${gcloud_region}" \
  --command './bin/shopify_lfm_balancer.js' \
  --args='update-shopify' \
  --args='-vvv' \
  --service-account "${service_acct}" \
  --memory='756Mi' \
  --max-retries=0 \
  --parallelism=0 \
  --set-secrets 'LFM_PASSWORD=LFM_PASSWORD:latest' \
  --set-secrets 'LFM_USERNAME=LFM_USERNAME:latest' \
  --set-secrets 'SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN:latest'

gcloud run deploy sjifh-shopify-listener \
  --image "${docker_img_path}" \
  --region "${gcloud_region}" \
  --command 'node' \
  --args='src/shopify_listener_service.js' \
  --port=8080 \
  --no-allow-unauthenticated \
  --service-account "${service_acct}" \
  --timeout=60 \
  --concurrency=5 \
  --cpu-boost \
  --max-instances=3 \
  --min-instances=1 \
  --platform="managed" \
  --cpu-throttling \
  --execution-environment='gen2' \
  --clear-env-vars \
  --set-secrets 'LFM_PASSWORD=LFM_PASSWORD:latest' \
  --set-secrets 'LFM_USERNAME=LFM_USERNAME:latest' \
  --set-secrets 'SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN:latest'
  # --set-env-vars='DEBUG=express:*' \
  # --set-config-maps=healthCheck.path=/healthz2,healthCheck.initialDelay=2,healthCheck.timeout=2,healthCheck.checkInterval=60 \

  # --command '/usr/src/app/bin/shopify_lfm_balancer.js update-shopify -vvv' \
# FIXME
# gcloud scheduler jobs list --location="us-west1" | grep update-shopify-from-lfm-scheduler-trigger

# gcloud scheduler jobs describe update-shopify-from-lfm-scheduler-trigger --location="us-west1" 2>/dev/null | grep -q "${shopify_update_schedule}"
if gcloud scheduler jobs describe update-shopify-from-lfm-scheduler-trigger --location="${gcloud_region}" 2>/dev/null | grep -q "${shopify_update_schedule}"; then
  gcloud scheduler jobs update http update-shopify-from-lfm-scheduler-trigger \
    --schedule="${shopify_update_schedule}" \
    --uri="https://${gcloud_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${gcloud_project}/jobs/update-shopify-from-lfm:run" \
    --http-method="POST" \
    --location="${gcloud_region}" \
    --max-retry-attempts=1 \
    --attempt-deadline="360s" \
    --oauth-service-account-email="${service_acct}"
  gcloud scheduler jobs resume update-shopify-from-lfm-scheduler-trigger \
    --location="${gcloud_region}"
else
  gcloud scheduler jobs delete update-shopify-from-lfm-scheduler-trigger --location="${gcloud_region}" --quiet

  gcloud scheduler jobs create http update-shopify-from-lfm-scheduler-trigger \
    --schedule="${shopify_update_schedule}" \
    --uri="https://${gcloud_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${gcloud_project}/jobs/update-shopify-from-lfm:run" \
    --http-method="POST" \
    --location="${gcloud_region}" \
    --max-retry-attempts=1 \
    --attempt-deadline="360s" \
    --oauth-service-account-email="${service_acct}"
fi


# # Configure the push subscription
# gcloud pubsub subscriptions (create|update|modify-push-config) ${SUBSCRIPTION} \
#  --topic=${TOPIC} \
#  --push-endpoint=${PUSH_ENDPOINT_URI} \
#  --push-auth-service-account=${SERVICE_ACCOUNT_EMAIL} \
#  --push-auth-token-audience=${OPTIONAL_AUDIENCE_OVERRIDE}

# # Your Google-managed service account
# # `service-{PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com` needs to have the
# # `iam.serviceAccountTokenCreator` role.
# PUBSUB_SERVICE_ACCOUNT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
# gcloud projects add-iam-policy-binding ${PROJECT_ID} \
#  --member="serviceAccount:${PUBSUB_SERVICE_ACCOUNT}"\
#  --role='roles/iam.serviceAccountTokenCreator'


# gcloud scheduler jobs create http update-shopify-from-lfm-scheduler-trigger \
#   --schedule="*/5 * * * *" \
#   --uri="https://us-west1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/sjifh-378705/jobs/update-shopify-from-lfm:run" \
#   --http-method="POST" \
#   --location="us-west1" \
#   --max-retry-attempts=1 \
#   --attempt-deadline="360s" \
#   --oauth-service-account-email="lfm-shopify@sjifh-378705.iam.gserviceaccount.com"

#   --headers Accept-Language=en-us,Accept=text/plain
#   --time-zone="TIMEZONE"

# https://us-west1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/sjifh-378705/jobs/update-shopify-from-lfm:run

# attemptDeadline: 180s
# httpTarget:
#   headers:
#     User-Agent: Google-Cloud-Scheduler
#   httpMethod: POST
#   oauthToken:
#     scope: https://www.googleapis.com/auth/cloud-platform
#     serviceAccountEmail: lfm-shopify@sjifh-378705.iam.gserviceaccount.com
#   uri: https://us-west1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/sjifh-378705/jobs/update-shopify-from-lfm:run
# lastAttemptTime: '2023-06-15T05:10:00.644764Z'
# name: projects/sjifh-378705/locations/us-west1/jobs/update-shopify-from-lfm-scheduler-trigger
# retryConfig:
#   maxBackoffDuration: 3600s
#   maxDoublings: 5
#   maxRetryDuration: 0s
#   minBackoffDuration: 5s
# schedule: '*/5 * * * *'
# scheduleTime: '2023-06-15T05:15:00.804492Z'
# state: ENABLED
# status: {}
# timeZone: Etc/UTC
# userUpdateTime: '2023-06-15T04:40:11Z'


# gcloud run jobs deploy update_shopify_from_lfm \
#   --image "${docker_img_path}" \
#   --region ${gcloud_region} \
#   --command 'update-shopify -vvv' \
#   --set-secrets 'LFM_PASSWORD=LFM_PASSWORD:latest' \
#   --set-secrets 'LFM_USERNAME=LFM_USERNAME:latest' \
#   --set-secrets 'SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN:latest'

#  --execute-now

# --service-account ${service_acct} \

# local default_function_opts='--gen2 \
# --runtime=nodejs18 \
# --trigger-http \
# --memory 256Mi \
# --region ${gcloud_region} \
# --project ${gcloud_project} '

# echo '---- Setting up ig-balance endpoint'
# eval "gcloud functions deploy ig-balance ${default_function_opts} \
#   --entry-point=igBalance \
#   --allow-unauthenticated \
#   --min-instances 1 \
#   --max-instances 3 \
#   --timeout 10 \
#   --ingress-settings=all \
#   --set-secrets 'STRIPE_API_KEY=${stripe_api_key_read_name}:latest'" &

# echo '---- Setting up wh-twilio endpoint'
# eval "gcloud functions deploy wh-twilio ${default_function_opts} \
#   --entry-point=whTwilio \
#   --allow-unauthenticated \
#   --min-instances 0 \
#   --max-instances 2 \
#   --timeout 10 \
#   --ingress-settings=all \
#   --set-secrets 'STRIPE_API_KEY=STRIPE_ISSUING_WRITE:latest' \
#   --set-secrets 'TWILIO_PHONE_NUMBER=TWILIO_PHONE_NUMBER:latest' \
#   --set-secrets 'TWILIO_ACCOUNT_SID=TWILIO_ACCOUNT_SID:latest' \
#   --set-secrets 'TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest'" &


# echo '---- Setting up wh-cardholder-setup endpoint'
# eval "gcloud functions deploy wh-cardholder-setup ${default_function_opts} \
#   --entry-point=whCardholderSetup \
#   --allow-unauthenticated \
#   --min-instances 0 \
#   --max-instances 2 \
#   --timeout 10 \
#   --ingress-settings=all \
#   --set-secrets 'STRIPE_API_KEY=${stripe_api_key_write_name}:latest' \
#   --set-secrets 'STRIPE_AUTH_WEBHOOK_SECRET=${stripe_api_key_cardholder_setup_name}:latest' \
#   --set-secrets 'TWILIO_PHONE_NUMBER=TWILIO_PHONE_NUMBER:latest' \
#   --set-secrets 'TWILIO_ACCOUNT_SID=TWILIO_ACCOUNT_SID:latest' \
#   --set-secrets 'TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest'" &


# echo '---- Setting up wh-authorization endpoint'
# eval "gcloud functions deploy wh-authorization ${default_function_opts} \
#   --entry-point=whAuthorization \
#   --allow-unauthenticated \
#   --min-instances 1 \
#   --max-instances 4 \
#   --timeout 5 \
#   --ingress-settings=all \
#   --set-secrets 'STRIPE_API_KEY=${stripe_api_key_write_name}:latest' \
#   --set-secrets 'STRIPE_AUTH_WEBHOOK_SECRET=${stripe_api_key_auth_webhook_name}:latest' \
#   --set-secrets 'TWILIO_PHONE_NUMBER=TWILIO_PHONE_NUMBER:latest' \
#   --set-secrets 'TWILIO_ACCOUNT_SID=TWILIO_ACCOUNT_SID:latest' \
#   --set-secrets 'TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest'" &


# echo '---- Setting up ig-update-cardholder-spending-rules endpoint'
# eval "gcloud functions deploy ig-update-cardholder-spending-rules ${default_function_opts} \
#   --entry-point=igUpdateCardholderSpendingRules \
#   --no-allow-unauthenticated \
#   --min-instances 0 \
#   --max-instances 1 \
#   --timeout 1200 \
#   --ingress-settings=all \
#   --service-account ${service_acct} \
#   --set-secrets 'STRIPE_API_KEY=${stripe_api_key_write_name}:latest'" &

# wait
# echo '---- all function deploys finished'


# local gcp_scheduler_cmd=create
# local previouslyScheduled=`gcloud scheduler jobs list --project ${gcloud_project} --location=${gcloud_region} --filter="${job_name}" | wc -l`
# if [[ $previouslyScheduled -gt 0 ]]; then
#   gcp_scheduler_cmd=update
# fi
# local update_cardholder_spending_rules_uri=`gcloud functions describe ig-update-cardholder-spending-rules --project ${gcloud_project} --format='json' | jq -r '.serviceConfig.uri'`

# echo "---- ${gcp_scheduler_cmd}ing scheduled job"
# eval "gcloud scheduler jobs ${gcp_scheduler_cmd} http ${job_name} \
#   --schedule '0 1 * * *' \
#   --location=${gcloud_region} \
#   --project ${gcloud_project} \
#   --http-method=POST \
#   --attempt-deadline=1800s \
#   --oidc-service-account-email=${service_acct} \
#   --uri=${update_cardholder_spending_rules_uri}"



# # gcloud dns --project=sjfood managed-zones create island-grown --description="" --dns-name="com." --visibility="public" --dnssec-state="on" --log-dns-queries


# local balance_uri=`gcloud functions describe ig-balance --project ${gcloud_project} --format='json' | jq -r '.serviceConfig.uri'`
# local auth_uri=`gcloud functions describe wh-authorization --project ${gcloud_project} --format='json' | jq -r '.serviceConfig.uri'`
# local cardholder_setup_uri=`gcloud functions describe wh-cardholder-setup --project ${gcloud_project} --format='json' | jq -r '.serviceConfig.uri'`
# local twilio_uri=`gcloud functions describe wh-twilio --project ${gcloud_project} --format='json' | jq -r '.serviceConfig.uri'`

# echo "\n\n\n------------------------------"
# echo "  balance endpoint uri:                ${balance_uri}"
# echo "  auth validation Stripe webhook uri:  ${auth_uri}"
# echo "  cardholder setup Stripe Webhook uri: ${cardholder_setup_uri}"
# echo "  twilio webhook uri:                  ${twilio_uri}"
# echo "\n"
# echo "  job setup for refill checks: ${job_name}"
