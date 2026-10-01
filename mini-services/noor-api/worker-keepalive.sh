#!/bin/bash
cd /home/z/my-project/mini-services/noor-api
export NOOR_SERVICE_TOKEN=dev-internal-token NOOR_ENGINE=opensearch NOOR_OPENSEARCH_URL=http://127.0.0.1:9200 NOOR_OS_INDEX=noor-passages
while true; do
  ./bin/worker >> worker-os.log 2>&1
  echo "$(date) WORKER_EXITED rc=$?" >> worker-os.log
  sleep 3
done
