import React, { useState } from 'react';
import axiosClient from '../api/axiosClient'; // note the relative path
import { TextField, Button, Typography, Alert } from '@mui/material';

function AddUserPage() {
  const [username, setUsername] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');

  async function handleCreateUser(e) {
    e.preventDefault();
    setError('');
    setApiKey('');

    if (!username) {
      setError('Username is required');
      return;
    }

    try {
      const res = await axiosClient.post('/api/v1/users', { username });
      setApiKey(res.data.user.apiKey);
      setUsername(''); 
    } catch (err) {
      console.error('Error creating user:', err);
      setError('Failed to create user');
    }
  }

  return (
    <>
      <Typography variant="h5" gutterBottom>
        Add New User
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <form onSubmit={handleCreateUser}>
        <TextField
          label="Username"
          variant="outlined"
          value={username}
          onChange={e => setUsername(e.target.value)}
          sx={{ mb: 2, display: 'block' }}
        />
        <Button variant="contained" type="submit">
          Create User
        </Button>
      </form>

      {apiKey && (
        <Alert severity="success" sx={{ mt: 2 }}>
          User created! API Key: <strong>{apiKey}</strong>
        </Alert>
      )}
    </>
  );
}

export default AddUserPage;