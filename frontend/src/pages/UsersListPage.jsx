// frontend/src/pages/UserList.jsx

import React, { useState, useEffect } from 'react';
import axiosClient from '../api/axiosClient';
import {
  Typography, Alert, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Button
} from '@mui/material';

function UserList() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    setError('');
    try {
      const res = await axiosClient.get('/api/v1/users');
      setUsers(res.data);
    } catch (err) {
      setError('Failed to fetch users');
    }
  }

  async function handleDeleteUser(userId) {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try {
      await axiosClient.delete(`/api/v1/users/${userId}`);
      // re-fetch
      fetchUsers();
    } catch (err) {
      setError('Failed to delete user.');
    }
  }

  return (
    <div>
      <Typography variant="h5" gutterBottom>All Users</Typography>
      {error && <Alert severity="error">{error}</Alert>}

      <TableContainer component={Paper} sx={{ mt: 2 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell> {/* front-end order */}
              <TableCell>User ID (DB)</TableCell>
              <TableCell>Username</TableCell>
              <TableCell>Created At</TableCell>
              <TableCell>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u, index) => (
              <TableRow key={u.id}>
                <TableCell>{index + 1}</TableCell> {/* 1..n */}
                <TableCell>{u.id}</TableCell>
                <TableCell>{u.username}</TableCell>
                <TableCell>{u.created_at}</TableCell>
                <TableCell>
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={() => handleDeleteUser(u.id)}
                  >
                    Delete
                  </Button>
                  {/* or "View Credentials" button that navigates somewhere */}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

export default UserList;