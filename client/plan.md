# CraftVerse Development Plan

## 1. Project Overview

CraftVerse is a two-day hackathon management system for approximately 25 teams, with 3-4 participants per team.

The system is a dashboard-first application. There is no public landing page.

### Primary goals

- Manage teams and participants
- Handle team registration at the venue
- Provide participant dashboards
- Provide admin and developer dashboards
- Deliver real-time event notifications
- Manage games and game control panels
- Manage individual food QR codes for every participant and every food break
- Manage game results and rankings
- Provide an inquiry system for participants

---

# 2. Technology Stack

## Frontend

- React
- Vite
- JavaScript
- React Router
- CSS / Tailwind CSS as decided during implementation

## Backend

- Node.js
- Express
- Socket.IO

## Database

- PostgreSQL

## Communication

Frontend and backend communicate through:

- REST/API where appropriate
- Socket.IO for real-time communication

The frontend never connects directly to PostgreSQL.

Architecture:

```text
React Frontend
      │
      ├──── REST/API ────► Node.js + Express ────► PostgreSQL
      │
      └──── Socket.IO ◄──► Node.js + Express
```

---

# 3. User Roles and Authority

There are four user types:

```text
DEV
ADMIN
TEAM
PARTICIPANT
```

Authority hierarchy:

```text
DEV > ADMIN > TEAM / PARTICIPANT
```

## DEV

Highest authority.

Responsibilities:

- Manage admins
- Manage teams
- Manage participants
- Manage games
- Configure the event
- View system status
- View logs
- Perform emergency/system operations

## ADMIN

Event management authority.

Responsibilities:

- Manage event operations
- Manage team registration
- Control games
- Send notifications
- Manage inquiries
- Manage food access
- View teams and participants
- View game results

## TEAM

Team-level access.

Responsibilities:

- View team information
- Access team registration QR
- View event information
- View notifications
- View games and results where permitted

## PARTICIPANT

Individual participant access.

Responsibilities:

- View participant dashboard
- View team information
- View ongoing event
- View games
- Receive notifications
- Display food QR
- Submit inquiries

---

# 4. Core Database Tables

The initial PostgreSQL schema should contain:

```text
users
teams
participants
registration
games
game_results
food_access
notifications
inquiries
```

Additional tables can be introduced only when required.

---

# 5. Teams

Approximately 25 teams will participate.

Each team receives a permanent organizer-assigned Team ID.

Examples:

```text
T01
T02
T03
...
T25
```

Team ID remains unchanged throughout the event.

### teams

Suggested fields:

```text
team_id
team_name
registration_token
registration_status
registered_at
created_at
updated_at
```

---

# 6. Participants

Teams and participants are separate entities.

Every participant belongs to one team.

### participants

Suggested fields:

```text
participant_id
name
email
phone
team_id
created_at
updated_at
```

Relationship:

```text
teams.team_id
      ▲
      │
participants.team_id
```

A team can have multiple participants.

---

# 7. Authentication / Users

The users table handles authentication and authorization.

Suggested fields:

```text
user_id
email
password_hash
role
participant_id
team_id
created_at
updated_at
```

Role values:

```text
DEV
ADMIN
TEAM
PARTICIPANT
```

Backend middleware must enforce role permissions.

Frontend hiding a button is not considered security.

---

# 8. Registration QR System

The registration QR is the replacement for the previously planned attendance QR.

It is NOT sent by email.

## Registration process

1. Participating teams register using Google Form.
2. Organizing team imports/enters team information into CraftVerse.
3. Each team receives a permanent Team ID.
4. Organizers provide the CraftVerse website link to teams.
5. When a team arrives, the team opens the website.
6. Before registration is completed, the team sees its Registration QR.
7. An organizing member scans the QR.
8. Backend validates the secure QR token.
9. If valid, the team is marked registered.
10. Participants belonging to that team can now access the participant dashboard.

Flow:

```text
Google Form
     ↓
Organizer
     ↓
CraftVerse database
     ↓
Team opens website
     ↓
Registration QR displayed
     ↓
Organizer scans QR
     ↓
Backend validates token
     ↓
Team registered
     ↓
Participant dashboard unlocked
```

## QR requirements

- QR must use a secure random token.
- Do not encode sensitive participant information directly.
- Registration QR is single-use.
- A second scan must show that the team has already registered.
- Registration status must be stored in PostgreSQL.

---

# 9. Participant Dashboard

Participants land directly on the dashboard after successful team registration.

There is no landing page.

The dashboard should contain:

## Profile / Team

- Participant name
- Participant ID
- Team ID
- Team name

## Ongoing Event

A prominent section showing the currently active event/game.

Example:

```text
ONGOING EVENT

Red Light Green Light
Status: LIVE

[ ENTER EVENT ]
```

If nothing is active:

```text
ONGOING EVENT

No event is currently active.
```

## Games

Show available games and their status:

```text
LIVE
UPCOMING
COMPLETED
LOCKED
```

## Notifications

Show announcements and real-time event updates.

## Food QR

Show the QR applicable to the participant's current food break.

## Inquiry

Participants can submit questions/issues.

Example:

```text
Inquiry:
"I have not received my lunch QR."

[ SEND INQUIRY ]
```

Inquiry statuses:

```text
OPEN
IN PROGRESS
RESOLVED
```

---

# 10. Admin Dashboard

There is no Current Event section.

The admin dashboard should contain:

## Overview

- Total teams
- Total participants
- Registered teams
- Current operational status

## Game Control Center

Do not put a game's control panel directly below a dropdown.

Instead, provide individual links/cards for each game's control panel.

Example:

```text
GAME CONTROL CENTER

Red Light Green Light
[ CONTROL PANEL ]

Game 2
[ CONTROL PANEL ]

Game 3
[ CONTROL PANEL ]
```

Routes can follow:

```text
/admin/games/red-light-green-light
/admin/games/game-2
/admin/games/game-3
```

Each game can therefore have its own specialized control panel.

## Notifications

Admin can:

- Create notification
- Select notification type
- Send notification
- View previous notifications

## Inquiries

Admin can:

- View inquiries
- Respond
- Change status
- Resolve inquiries

## Teams

Admin can:

- View teams
- View participants
- View registration status

---

# 11. DEV Dashboard

The DEV dashboard has the highest authority.

It should provide:

- System status
- Database status
- Backend status
- Connected users
- User management
- Admin management
- Team management
- Participant management
- Game management
- Event configuration
- Logs
- Emergency controls

DEV can perform all actions available to ADMIN.

---

# 12. Food QR System

Food QR codes are individual to each participant.

A new QR is generated for every food break.

Examples:

```text
P001 + Day 1 Breakfast
P001 + Day 1 Lunch
P001 + Day 1 Dinner
P001 + Day 2 Breakfast
P001 + Day 2 Lunch
```

The QR is not shared by the whole team.

## food_access

Suggested fields:

```text
food_access_id
participant_id
meal_type
event_day
token
status
used_at
created_at
```

Possible status:

```text
UNUSED
USED
EXPIRED
```

## Food verification flow

```text
Participant opens dashboard
        ↓
Current food break detected
        ↓
Corresponding QR displayed
        ↓
Staff scans QR
        ↓
Backend validates token
        ↓
Check participant
        ↓
Check meal
        ↓
Check event day
        ↓
Check whether already used
        ↓
Grant or reject food access
```

A used QR cannot be reused.

---

# 13. Notification System

Notifications are stored in PostgreSQL and delivered in real time through Socket.IO.

Example:

```text
Admin
  ↓
Create notification
  ↓
Backend
  ├── Save notification to PostgreSQL
  └── Socket.IO emit
          ↓
   Participant dashboards
```

Notification types:

```text
NORMAL
IMPORTANT
GAME
EMERGENCY
```

Examples:

- Game starts in 10 minutes.
- Lunch is now available.
- All teams report to Arena 1.
- Emergency announcement.

---

# 14. Inquiry System

Participants can submit inquiries from their dashboard.

### inquiries

Suggested fields:

```text
inquiry_id
participant_id
team_id
title
message
status
response
created_at
updated_at
resolved_at
```

Statuses:

```text
OPEN
IN_PROGRESS
RESOLVED
```

Flow:

```text
Participant
    ↓
Submit inquiry
    ↓
Backend
    ↓
PostgreSQL
    ↓
Admin receives notification
    ↓
Admin responds
    ↓
Participant receives real-time update
```

---

# 15. Game System

Games are independent modules.

Core table:

### games

Suggested fields:

```text
game_id
name
description
rules
status
created_at
updated_at
```

Possible game status:

```text
UPCOMING
LIVE
PAUSED
COMPLETED
LOCKED
```

Every game gets its own admin control panel.

---

# 16. Game Results

Do not create a completely different database schema/table for every game.

Use a reusable `game_results` table.

Suggested fields:

```text
result_id
game_id
team_id
rank
score
time
status
created_at
updated_at
```

Example:

```text
game_results

Game: RLGL

T01 | Rank 1 | Score 98 | Qualified
T02 | Rank 2 | Score 94 | Qualified
T03 | Rank - | Score  0 | Disqualified
```

When another game starts, the same structure is reused with a different `game_id`.

Historical results should NOT be permanently deleted. They should remain available for leaderboards and event history.

---

# 17. Red Light Green Light

## Rules

- Problem statement is displayed on the projector.
- During Green Light, teams code.
- During Red Light, teams must stop coding.
- A team coding during Red Light is disqualified.
- Fastest accurate solution wins.
- Top 3 teams are winners.

## Game states

```text
WAITING
   ↓
COUNTDOWN
   ↓
GREEN
   ↓
RED
   ↓
GREEN
   ↓
RED
   ↓
...
   ↓
FINISHED
```

The backend is the authoritative source for the game state.

## Admin control panel

Example:

```text
RED LIGHT GREEN LIGHT

Status: WAITING

[ START ]

[ GREEN LIGHT ]
[ RED LIGHT ]

[ PAUSE ]
[ END GAME ]

Problem Statement
[ Update Problem ]

Teams
T01 [ Disqualify ]
T02 [ Disqualify ]
...
T25 [ Disqualify ]
```

The game control panel is accessed through its own link:

```text
/admin/games/red-light-green-light
```

---

# 18. Red Light Green Light Real-Time Flow

Admin presses RED:

```text
Admin
  ↓
Socket.IO
  ↓
Backend
  ├── Update game state
  ├── Save state to PostgreSQL
  └── Broadcast RED event
          ↓
All participant clients
          ↓
RED LIGHT
```

When a participant refreshes the page, the frontend obtains the current state from the backend/database so the correct state is restored.

Do not rely solely on client-side timers or state.

---

# 19. Cheating / Red Light Detection

The initial system should not automatically disqualify teams based solely on keyboard activity.

Organizers can monitor teams and manually disqualify them.

Admin:

```text
Teams

T01  [ Disqualify ]
T02  [ Disqualify ]
T03  [ Disqualify ]
```

Future versions can introduce browser-based coding/activity monitoring if teams code inside a CraftVerse editor.

---

# 20. Real-Time Architecture

Use REST/API for normal data operations and Socket.IO for real-time events.

### REST/API

Examples:

```text
GET /api/profile
GET /api/teams
GET /api/games
GET /api/notifications

POST /api/login
POST /api/inquiries
POST /api/registration/verify
POST /api/food/verify
```

### Socket.IO

Examples:

```text
game_started
game_state_changed
notification_created
inquiry_updated
registration_completed
food_access_updated
```

Architecture:

```text
                    React
                  /                    REST/API   Socket.IO
                │           │
                ▼           ▼
             Express <──── Socket.IO
                │
                ▼
           PostgreSQL
```

---

# 21. Project Structure

Recommended structure:

```text
CraftVerse/
│
├── client/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── admin/
│   │   ├── dev/
│   │   ├── games/
│   │   ├── context/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
│
├── server/
│   ├── controllers/
│   ├── routes/
│   ├── models/
│   ├── middleware/
│   ├── sockets/
│   ├── services/
│   ├── utils/
│   ├── config/
│   ├── server.js
│   └── package.json
│
├── .gitignore
├── README.md
└── plan.md
```

---

# 22. Development Phases

## Phase 1: Project Foundation

- [ ] Set up React/Vite frontend
- [ ] Set up Node.js/Express backend
- [ ] Set up PostgreSQL
- [ ] Configure environment variables
- [ ] Configure Git
- [ ] Establish client/server communication

## Phase 2: Authentication

- [ ] Users table
- [ ] Login
- [ ] Password hashing
- [ ] Session/JWT strategy
- [ ] Role-based authorization
- [ ] Protected routes

## Phase 3: Teams and Participants

- [ ] Teams table
- [ ] Participants table
- [ ] Team IDs
- [ ] Participant-team relationship
- [ ] Admin team management
- [ ] Dev team management

## Phase 4: Registration QR

- [ ] Generate secure registration token
- [ ] Display team QR
- [ ] Organizer scan page
- [ ] Validate QR
- [ ] Mark team registered
- [ ] Prevent duplicate registration
- [ ] Unlock participant dashboard

## Phase 5: Dashboards

- [ ] Participant dashboard
- [ ] Team dashboard
- [ ] Admin dashboard
- [ ] Dev dashboard
- [ ] Role-based navigation

## Phase 6: Notifications

- [ ] Notification database
- [ ] Admin notification creation
- [ ] Socket.IO notification delivery
- [ ] Notification history
- [ ] Read/unread status

## Phase 7: Inquiry

- [ ] Inquiry creation
- [ ] Admin inquiry list
- [ ] Inquiry responses
- [ ] Inquiry status
- [ ] Real-time updates

## Phase 8: Food QR

- [ ] Food access table
- [ ] Generate participant-specific meal QR
- [ ] Display current meal QR
- [ ] Scan/verification interface
- [ ] Prevent QR reuse
- [ ] Meal history

## Phase 9: Game System

- [ ] Games table
- [ ] Game listing
- [ ] Individual control panel links
- [ ] Game permissions
- [ ] Game results
- [ ] Game history

## Phase 10: Red Light Green Light

- [ ] Problem statement
- [ ] Game states
- [ ] Start control
- [ ] Green light
- [ ] Red light
- [ ] Timer
- [ ] Real-time synchronization
- [ ] Team disqualification
- [ ] Results
- [ ] Top 3 winners

## Phase 11: Polish and Testing

- [ ] Responsive UI
- [ ] Error handling
- [ ] Loading states
- [ ] Authentication security
- [ ] QR security
- [ ] Permission testing
- [ ] Socket.IO reconnection handling
- [ ] Database backup strategy
- [ ] Event-day testing
- [ ] Production deployment

---

# 23. Development Priority

Build in this order:

```text
1. Project setup
        ↓
2. PostgreSQL schema
        ↓
3. Backend
        ↓
4. Authentication
        ↓
5. Teams + Participants
        ↓
6. Registration QR
        ↓
7. Dashboards
        ↓
8. Socket.IO
        ↓
9. Notifications
        ↓
10. Inquiry
        ↓
11. Food QR
        ↓
12. Game system
        ↓
13. Red Light Green Light
        ↓
14. Testing
        ↓
15. Deployment
```

Do not start implementing all features simultaneously.

---

# 24. MVP

The first working version should contain:

- [ ] Login
- [ ] Team/participant data
- [ ] Registration QR
- [ ] Registration verification
- [ ] Participant dashboard
- [ ] Admin dashboard
- [ ] Notification system
- [ ] Inquiry system
- [ ] Food QR
- [ ] Game listing
- [ ] Red Light Green Light
- [ ] Admin game control
- [ ] Game results

Everything else can be added after the MVP is stable.

---

# 25. Important Design Principles

1. PostgreSQL is the permanent source of truth.
2. React never connects directly to PostgreSQL.
3. Backend validates every important operation.
4. Socket.IO is used for real-time communication.
5. Team IDs are permanent organizer-assigned identifiers.
6. Participants have a `team_id` foreign key.
7. Registration QR is single-use.
8. Food QR is individual and meal-specific.
9. Game results are reusable across games and historical results are retained.
10. Authority is enforced on the backend:
   `DEV > ADMIN > TEAM/PARTICIPANT`.
11. Game control panels are separate pages/links.
12. Participant dashboard contains Ongoing Event and Inquiry.
13. Admin dashboard does not contain a Current Event section.
14. No public landing page is required.
15. Build the core management system before adding visual polish or additional games.

---

# 26. Immediate Next Steps

Start implementation with:

```text
Step 1
Create client and server directories.

Step 2
Set up React/Vite.

Step 3
Set up Node.js + Express.

Step 4
Set up PostgreSQL database.

Step 5
Create the initial database schema.

Step 6
Create backend API structure.

Step 7
Create authentication and roles.

Step 8
Build participant/admin/dev/team dashboards.

Step 9
Add Socket.IO.

Step 10
Implement registration QR.

Step 11
Implement food QR.

Step 12
Implement game system.

Step 13
Implement Red Light Green Light.
```

The architecture should remain modular so that additional games can be added without restructuring the core system.
