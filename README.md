**Tap & Pay - RFID Cashless Payment System**

A complete IoT-based cashless payment solution using ESP8266, RFID cards, and MQTT. Designed for small businesses, cafeterias, and events to process payments and manage digital wallets via NFC cards.

**Features**

- **RFID Card Payments** - Tap MFRC522-compatible cards to pay or top-up wallets
- **Real-time Dashboard** - Web UI showing live transactions, card status, and session management
- **5-Second Session Grace Period** - Card removal triggers countdown; tap again within 5s to resume
- **Toast Notifications** - Modern feedback for errors and successful transactions
- **Dual Interface** - Cashier (payment) and Admin (top-up) panels
- **MQTT Communication** - Reliable pub/sub messaging between devices and backend
- **Wallet Registration** - Onboard new cards with PIN protection
- **Device Health Monitoring** - ESP8266 reports WiFi signal, free heap, and uptime

**Tech Stack**

- **Hardware**: ESP8266 + MFRC522 RFID reader
- **Backend**: Node.js, Express, Socket.IO, MQTT.js, SQLite
- **Frontend**: HTML5, Tailwind CSS, Lucide icons
- **Protocol**: MQTT (broker.benax.rw)
- **Database**: SQLite3

**MQTT Topics**

| Topic | Direction | Description |
|-------|-----------|-------------|
| `rfid/<team>/card/status` | ESP → Backend | Card detected/removed events |
| `rfid/<team>/card/balance` | ESP → Backend | Balance updates |
| `rfid/<team>/card/topup` | Backend → ESP | Recharge commands |
| `rfid/<team>/card/payment` | Backend → ESP | Payment confirmations |
| `rfid/<team>/device/health` | ESP → Backend | Device telemetry |
| `rfid/<team>/device/status` | ESP → Backend | Online/offline LWT |

**How It Works**

1. User taps RFID card on ESP8266 reader
2. ESP publishes `detected` status to MQTT
3. Backend queries SQLite database, emits `card_scanned` via Socket.IO
4. Dashboard shows user profile and balance
5. Cashier enters amount + PIN, backend processes payment
6. User removes card → 5s countdown → session clears

**Files**

```
arduino/card/card.ino    - ESP8266 firmware (WiFi, MQTT, RFID polling)
backend/src/server.js    - Express server, MQTT client, REST API
frontend/index.html      - Single-page dashboard with Socket.IO
```

**Team ID**: `team-cr7`
http://157.173.101.159:9221/