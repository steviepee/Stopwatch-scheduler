# Stopwatch Scheduler

A full-stack application that tracks task completion times and automatically syncs them to Google Calendar. Record how long tasks actually take, and when you add them to your calendar, they'll automatically use the correct duration.

## Features

- Stopwatch timer for tracking work sessions
- Save time logs for specific tasks
- Automatic calculation of average task duration
- Google Calendar integration - events automatically use recorded durations
- Clean, mobile-friendly UI optimized for quick access

## Tech Stack

**Frontend:**
- React 18 with TypeScript
- React Router for navigation
- TailwindCSS for styling
- Vite for fast development
- Axios for API calls

**Backend:**
- Python with FastAPI
- SQLAlchemy ORM
- MySQL database
- Google Calendar API integration

## Prerequisites

- Node.js (v18 or higher)
- Python 3.10 or higher
- MySQL 8.0 or higher
- Google Cloud account (for Calendar API)

## Project Structure

```
Stopwatch-scheduler/
├── frontend/          # React TypeScript frontend
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── pages/        # Page components
│   │   ├── hooks/        # Custom hooks (stopwatch)
│   │   ├── services/     # API integration
│   │   └── types/        # TypeScript types
│   └── package.json
├── backend/           # FastAPI Python backend
│   ├── app/
│   │   ├── models/       # Database models
│   │   ├── routers/      # API endpoints
│   │   ├── services/     # Business logic
│   │   └── main.py       # Application entry
│   └── requirements.txt
└── README.md
```

## Setup Instructions

### 1. Database Setup

Create a MySQL database:

```bash
mysql -u root -p
CREATE DATABASE stopwatch_scheduler;
EXIT;
```

### 2. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file from example
cp .env.example .env

# Edit .env with your database credentials
# Update DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME
```

### 3. Google Calendar Setup (Optional but Recommended)

Follow the detailed guide in [GOOGLE_CALENDAR_SETUP.md](./GOOGLE_CALENDAR_SETUP.md) to:
1. Create a Google Cloud project
2. Enable Google Calendar API
3. Get OAuth 2.0 credentials
4. Add credentials to your `.env` file

### 4. Frontend Setup

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install
```

## Running the Application

You'll need two terminal windows - one for backend, one for frontend.

### Terminal 1: Start Backend

```bash
cd backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
uvicorn app.main:app --reload --port 8000
```

Backend will run at: `http://localhost:8000`

### Terminal 2: Start Frontend

```bash
cd frontend
npm run dev
```

Frontend will run at: `http://localhost:3000`

## Usage

1. **Create Tasks**: Add tasks you want to track (e.g., "Write blog post", "Code review")

2. **Track Time**: Use the stopwatch to time yourself completing a task
   - Click Start when you begin
   - Click Stop when finished
   - Select the task and save

3. **View Averages**: Each task shows its average duration based on all recorded sessions

4. **Google Calendar**: Connect your Google Calendar and add events that automatically use the average duration for each task

## API Endpoints

### Tasks
- `GET /api/tasks` - Get all tasks
- `GET /api/tasks/{id}` - Get task by ID
- `POST /api/tasks` - Create new task
- `PUT /api/tasks/{id}` - Update task
- `DELETE /api/tasks/{id}` - Delete task

### Time Logs
- `GET /api/time-logs` - Get all time logs
- `POST /api/time-logs` - Create time log
- `DELETE /api/time-logs/{id}` - Delete time log

### Google Calendar
- `GET /api/auth/google/login` - Get OAuth login URL
- `GET /api/auth/callback` - OAuth callback
- `GET /api/auth/status` - Check authentication status
- `POST /api/auth/calendar/event` - Create calendar event

## Development

### Frontend Development
```bash
cd frontend
npm run dev      # Start dev server
npm run build    # Build for production
npm run lint     # Run linter
```

### Backend Development
```bash
cd backend
uvicorn app.main:app --reload  # Auto-reload on changes
```

## Environment Variables

### Backend (.env)
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=stopwatch_scheduler

GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/callback

API_PORT=8000
CORS_ORIGINS=http://localhost:3000
```

## Troubleshooting

### Backend won't start
- Check MySQL is running: `mysql -u root -p`
- Verify database exists: `SHOW DATABASES;`
- Check .env credentials are correct

### Frontend won't connect to backend
- Ensure backend is running on port 8000
- Check browser console for CORS errors
- Verify Vite proxy configuration in `vite.config.ts`

### Google Calendar not working
- See [GOOGLE_CALENDAR_SETUP.md](./GOOGLE_CALENDAR_SETUP.md)
- Check OAuth credentials in .env
- Verify redirect URI matches Google Cloud Console

## License

MIT License - see LICENSE file for details

## Contributing

Pull requests welcome! Please ensure your code follows the existing style and includes appropriate tests.
