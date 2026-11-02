#!/bin/sh
exec docker exec -i "${GUIDE_PG_CONTAINER:-oss-hub-guide-postgres-1}" psql -U oss -d oss_hub "$@"
