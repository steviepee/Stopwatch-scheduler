import { useState } from 'react';
import { authAPI } from '../services/api';

interface SignInProps {
  onSignedIn: () => void;
}

export default function SignIn({ onSignedIn }: SignInProps) {
  const [token, setToken] = useState('');
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(false);
    try {
      await authAPI.signIn(token);
      setToken('');
      onSignedIn();
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="signin-screen" className="glass-background flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="glass-card rounded-2xl p-6 space-y-4 w-full max-w-sm">
        <h2 className="text-xl font-bold text-white">Stopwatch Scheduler</h2>
        <label htmlFor="api-token" className="block text-white/60 text-xs uppercase tracking-wider">
          API token
        </label>
        <input
          id="api-token"
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          autoComplete="current-password"
          className="glass-input w-full px-4 py-3 rounded-xl"
        />
        {error && <p className="text-red-300 text-sm">That token didn't work</p>}
        <button
          type="submit"
          disabled={submitting || !token}
          className="glass-button w-full px-4 py-3 rounded-xl"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
