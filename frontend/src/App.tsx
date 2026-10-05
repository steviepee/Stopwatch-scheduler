import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import SignIn from './components/SignIn';
import { authAPI, onUnauthorized } from './services/api';

function App() {
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    onUnauthorized(() => setSignedOut(true));
    return () => onUnauthorized(null);
  }, []);

  const handleSignOut = async () => {
    await authAPI.signOut();
    setSignedOut(true);
  };

  if (signedOut) {
    return <SignIn onSignedIn={() => setSignedOut(false)} />;
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage onSignOut={handleSignOut} />} />
      </Routes>
    </Router>
  );
}

export default App;
