#pragma once
#include "supabase_root_ca.h"

// Copy this file to secrets.h and fill in local values. Never commit secrets.h.
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define DEVICE_ID "00000000-0000-4000-8000-000000000000"
#define DEVICE_TOKEN "replace-with-a-long-random-device-token"
#define INGEST_URL "https://hksahvlcljikisqkxbza.supabase.co/functions/v1/ingest-reading"

#define SUPABASE_ROOT_CA SICKLECARE_SUPABASE_ROOT_CA
