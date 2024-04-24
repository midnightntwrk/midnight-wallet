#!/bin/bash

if [ "$#" -ne 5 ]; then
    echo "Usage: $0 ALLURE_RESULTS_DIRECTORY PROJECT_ID IS_SECURE ALLURE_GENERATE ALLURE_CLEAN_RESULTS"
    exit 1
fi

ALLURE_RESULTS_DIRECTORY=$1
PROJECT_ID=$2
IS_SECURE=$3
ALLURE_GENERATE=$4
ALLURE_CLEAN_RESULTS=$5

SECURITY_USER=$ALLURE_ADMIN_USER
SECURITY_PASS=$ALLURE_ADMIN_PASSWORD
ALLURE_HOST=allure-server.stg.midnight.tools
ALLURE_SERVER="https://$ALLURE_HOST"

FILES_TO_SEND=$(ls -dp $ALLURE_RESULTS_DIRECTORY/* | grep -v /$)

if [ -z "$FILES_TO_SEND" ]; then
    echo "no files found"
    exit 1
fi

FILES=''
for FILE in $FILES_TO_SEND; do
    FILES+="-F files[]=@$FILE "
done

if [[ "$IS_SECURE" == "true" ]]; then
    if [ -z "$SECURITY_USER" ]; then
        echo "no auth username provided"
        exit 1
    fi
    if [ -z "$SECURITY_PASS" ]; then
        echo "no auth password provided"
        exit 1
    fi

    # set +o xtrace
    echo "------------------LOGIN-----------------"
    curl -X POST "$ALLURE_SERVER/allure-docker-service/login" \
    -H 'Content-Type: application/json' \
    -d "{
        "\""username"\"": "\""$SECURITY_USER"\"",
        "\""password"\"": "\""$SECURITY_PASS"\""
    }" -c cookiesFile -ik --silent --output /dev/null --show-error --fail
    echo "done"
    echo "------------------EXTRACTING-CSRF-ACCESS-TOKEN------------------"
    CRSF_ACCESS_TOKEN_VALUE=$(cat cookiesFile | grep -o 'csrf_access_token.*' | cut -f2)
    echo "done"
    # echo "csrf_access_token value: $CRSF_ACCESS_TOKEN_VALUE"
fi

# print the upcoming report html link
if [[ "$IS_SECURE" == "true" ]]; then
    LATEST_REPORT_ID=$(curl --request GET --silent --url $ALLURE_SERVER/allure-docker-service/projects/$PROJECT_ID -H "X-CSRF-TOKEN: $CRSF_ACCESS_TOKEN_VALUE" -b cookiesFile | jq -r '.data.project.reports_id[1]')
else
    LATEST_REPORT_ID=$(curl --request GET --silent --url $ALLURE_SERVER/allure-docker-service/projects/$PROJECT_ID | jq -r '.data.project.reports_id[1]')
fi
REPORT_LINK="http://$ALLURE_HOST/allure-docker-service-ui/projects/$PROJECT_ID/reports/$(($LATEST_REPORT_ID + 1))"
echo "Allure Report Link: $REPORT_LINK"

if [[ "$ALLURE_CLEAN_RESULTS" == "true" ]]; then
    echo "------------------CLEAN-RESULTS------------------"
    CLEAN_RESULTS_URL="$ALLURE_SERVER/allure-docker-service/clean-results?project_id=$PROJECT_ID"
    if [[ "$IS_SECURE" == "true" ]]; then
        RESPONSE=$(curl -X GET "$CLEAN_RESULTS_URL" -H "X-CSRF-TOKEN: $CRSF_ACCESS_TOKEN_VALUE" -b cookiesFile)
    else
        RESPONSE=$(curl -X GET "$CLEAN_RESULTS_URL")
    fi
    echo "done clean results"
fi

echo "------------------SEND-RESULTS------------------"
if [[ "$IS_SECURE" == "true" ]]; then
    curl -X POST "$ALLURE_SERVER/allure-docker-service/send-results?project_id=$PROJECT_ID" \
    -H 'Content-Type: multipart/form-data' \
    -H "X-CSRF-TOKEN: $CRSF_ACCESS_TOKEN_VALUE" \
    -b cookiesFile $FILES -ik
    set -o xtrace
else
    curl --silent --output /dev/null --show-error --fail -X POST -H 'Content-Type: multipart/form-data' "$ALLURE_SERVER/allure-docker-service/send-results?project_id=$PROJECT_ID&force_project_creation=true" $FILES
fi
echo "done send-results"

if [[ "$ALLURE_GENERATE" == "true" ]]; then
    echo "-----------------GENERATE-REPORT----------------"
    EXECUTION_NAME='GitHub+Actions'
    EXECUTION_FROM="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
    EXECUTION_FROM_ENCODED="$(curl -s -o /dev/null -w %{url_effective} --get --data-urlencode "$EXECUTION_FROM" "" | cut -c 3-)"

    GENERATE_URL="$ALLURE_SERVER/allure-docker-service/generate-report?project_id=$PROJECT_ID&execution_name=$EXECUTION_NAME&execution_from=$EXECUTION_FROM_ENCODED"
    if [[ "$IS_SECURE" == "true" ]]; then
        RESPONSE=$(curl -X GET "$GENERATE_URL" -H "X-CSRF-TOKEN: $CRSF_ACCESS_TOKEN_VALUE" -b cookiesFile)
    else
        RESPONSE=$(curl -X GET "$GENERATE_URL")
    fi
    REPORT_LINK=$(grep -o '"report_url":"[^"]*' <<< "$RESPONSE" | grep -o '[^"]*$')
    echo "Allure Report Link: $REPORT_LINK"
fi
