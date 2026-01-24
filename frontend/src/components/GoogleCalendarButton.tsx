import { useState, useEffect } from 'react';
import { googleCalendarAPI } from '../services/api';

interface GoogleCalendarButtonProps {
  taskName?: string;
  duration?: number;
}

export default function GoogleCalendarButton({ taskName, duration }: GoogleCalendarButtonProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const status = await googleCalendarAPI.checkAuthStatus();
      setIsAuthenticated(status.authenticated);
    } catch (error) {
      console.error('Error checking auth status:', error);
    }
  };

  const handleLogin = async () => {
    try {
      setLoading(true);
      const response = await googleCalendarAPI.login();
      window.open(response.auth_url, '_blank');
      // Recheck auth status after a delay
      setTimeout(checkAuthStatus, 3000);
    } catch (error) {
      console.error('Error logging in:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCalendar = async () => {
    if (!taskName || !duration) return;

    try {
      setLoading(true);
      await googleCalendarAPI.createEvent(taskName, duration);
      alert('Event added to Google Calendar!');
    } catch (error) {
      console.error('Error adding to calendar:', error);
      alert('Failed to add event to calendar');
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <button
        onClick={handleLogin}
        disabled={loading}
        className="bg-white hover:bg-gray-50 text-gray-800 font-semibold py-2 px-4 border border-gray-300 rounded-lg shadow transition flex items-center gap-2"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        Connect Google Calendar
      </button>
    );
  }

  return (
    <button
      onClick={handleAddToCalendar}
      disabled={loading || !taskName || !duration}
      className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white font-semibold py-2 px-4 rounded-lg transition"
    >
      {loading ? 'Adding...' : 'Add to Calendar'}
    </button>
  );
}
