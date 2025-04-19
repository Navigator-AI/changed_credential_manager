// frontend/src/pages/ManageUserPage.jsx
import React, { useEffect, useState } from 'react';
import axiosClient from '../api/axiosClient';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography,
  Button,
  Alert,
  List,
  ListItem,
  ListItemText,
  TextField
} from '@mui/material';

function ManageUserPage() {
  const { id } = useParams();         // user ID from the route
  const navigate = useNavigate();
  
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [addingCred, setAddingCred] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [apiKey, setApiKey] = useState(''); // If we want to do "authMiddleware" calls

  useEffect(() => {
    fetchUser();
  }, [id]);

  async function fetchUser() {
    setError('');
    try {
      const res = await axiosClient.get(`/api/v1/users/${id}`);
      setUser(res.data);
      // If you want to use "authMiddleware" to add/delete credentials, you'd need the user’s API key
      // but that means we must store it plain or ask the user
      setApiKey(res.data.api_key_plain || '');
    } catch (err) {
      console.error('Error fetching user:', err);
      setError('Failed to fetch user.');
    }
  }

  // Add a new credential using the user's API key
  async function handleAddCredential(e) {
    e.preventDefault();
    setError('');
    if (!apiKey) {
      setError('No API key available for this user. Cannot add credential via the API.');
      return;
    }
    try {
      await axiosClient.post(
        '/api/v1/credentials',
        { keyName, keyValue },
        { params: { apiKey } }
      );
      // Refresh user data to see new credential
      await fetchUser();
      setKeyName('');
      setKeyValue('');
      setAddingCred(false);
    } catch (err) {
      console.error('Error adding credential:', err);
      setError('Failed to add credential. Check API key or server logs.');
    }
  }

  // Delete a credential using the user's API key
  async function handleDeleteCredential(credId) {
    setError('');
    if (!apiKey) {
      setError('No API key available for this user. Cannot delete credential via the API.');
      return;
    }
    try {
      await axiosClient.delete(`/api/v1/credentials/${credId}`, {
        params: { apiKey }
      });
      // Refresh
      await fetchUser();
    } catch (err) {
      console.error('Error deleting credential:', err);
      setError('Failed to delete credential.');
    }
  }

  // Delete entire user (server route)
  async function handleDeleteUser() {
    setError('');
    const confirmDelete = window.confirm('Are you sure you want to delete this user? This will drop the DBs too.');
    if (!confirmDelete) return;

    try {
      await axiosClient.delete(`/api/v1/users/${id}`);
      // redirect to users list
      navigate('/users');
    } catch (err) {
      console.error('Error deleting user:', err);
      setError('Failed to delete user.');
    }
  }

  if (!user) {
    return <Typography>Loading user data...</Typography>;
  }

  return (
    <div>
      <Typography variant="h5">Manage User: {user.username}</Typography>
      {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}

      <Typography variant="body1">User ID: {user.id}</Typography>
      <Typography variant="body1">Created At: {user.created_at}</Typography>
      <Typography variant="body1">
        API Key (Plain): <strong>{user.api_key_plain || '(not stored)'}</strong>
      </Typography>
      <Button variant="contained" color="error" sx={{ mt: 2 }} onClick={handleDeleteUser}>
        Delete User
      </Button>

      <hr style={{ margin: '24px 0' }} />

      <Typography variant="h6">Credentials</Typography>
      {/* Listing existing credentials */}
      {!user.credentials?.length && <Typography>No credentials found.</Typography>}
      <List>
        {user.credentials?.map((cred) => (
          <ListItem key={cred.id} secondaryAction={
            <Button variant="outlined" color="error" onClick={() => handleDeleteCredential(cred.id)}>
              Delete
            </Button>
          }>
            <ListItemText
              primary={cred.key_name + ' = ' + cred.key_value}
            />
          </ListItem>
        ))}
      </List>

      {/* Add Credential Form */}
      {addingCred ? (
        <form onSubmit={handleAddCredential}>
          <TextField
            label="Key Name"
            variant="outlined"
            value={keyName}
            onChange={e => setKeyName(e.target.value)}
            sx={{ mb: 2, display: 'block' }}
          />
          <TextField
            label="Key Value"
            variant="outlined"
            value={keyValue}
            onChange={e => setKeyValue(e.target.value)}
            sx={{ mb: 2, display: 'block' }}
          />
          <Button variant="contained" type="submit">Add Credential</Button>
          <Button sx={{ ml: 2 }} onClick={() => setAddingCred(false)}>Cancel</Button>
        </form>
      ) : (
        <Button
          variant="outlined"
          sx={{ mt: 2 }}
          onClick={() => setAddingCred(true)}
        >
          Add Credential
        </Button>
      )}
    </div>
  );
}

export default ManageUserPage;