// frontend/src/pages/CredentialsPage.jsx

import React, { useEffect, useState } from 'react';
import axiosClient from '../api/axiosClient';
import {
  Typography,
  Alert,
  Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper,
  Button, TextField, IconButton,
  List, ListItem, ListItemText,
  Grid, Card, CardContent,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Chip, Tooltip, Box, Snackbar,
  useTheme, useMediaQuery,
  Divider, CircularProgress,
  Autocomplete
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  ContentCopy as CopyIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';

// Common credential key names for autocomplete
const commonKeyNames = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASS',
  'DB_NAME_TIMING_REPORT',
  'DB_NAME_QOR',
  'DB_NAME_DRC',
  'DB_NAME_REPORTS',
  'SLACK_BOT_TOKEN',
  'SLACK_CHANNEL_ID',
  'TEAMS_WEBHOOK_URL',
  'GRAFANA_API_KEY',
  'GRAFANA_URL',
  'GRAFANA_UID_TIMING_REPORT',
  'GRAFANA_UID_QOR',
  'GRAFANA_UID_DRC',
  'GRAFANA_UID_REPORTS',
];

function CredentialsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [addCredentialOpen, setAddCredentialOpen] = useState(false);

  // For adding a new credential
  const [keyName, setKeyName] = useState('');
  const [keyValue, setKeyValue] = useState('');

  // For editing a credential
  const [editingCredential, setEditingCredential] = useState(null);
  const [editKeyValue, setEditKeyValue] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const showSnackbar = (message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  async function fetchUsers() {
    setLoading(true);
    setError('');
    try {
      const res = await axiosClient.get('/api/v1/users');
      setUsers(res.data);
    } catch (err) {
      console.error('[DEBUG] Error fetching users:', err);
      setError('Failed to fetch users.');
      showSnackbar('Failed to fetch users', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleViewCredentials(userId) {
    setLoading(true);
    setError('');
    setSelectedUser(null);
    try {
      const userRes = await axiosClient.get(`/api/v1/users/${userId}`);
      const credRes = await axiosClient.get(`/api/v1/users/${userId}/credentials`);
      setSelectedUser({
        ...userRes.data,
        credentials: credRes.data
      });
      resetCredentialForms();
    } catch (err) {
      console.error('[DEBUG] Error fetching credentials:', err);
      setError('Failed to fetch user credentials.');
      showSnackbar('Failed to fetch credentials', 'error');
    } finally {
      setLoading(false);
    }
  }

  function resetCredentialForms() {
    setKeyName('');
    setKeyValue('');
    setEditingCredential(null);
    setEditKeyValue('');
  }

  async function handleAddCredential(e) {
    e.preventDefault();
    if (!selectedUser) return;

    if (!keyName || !keyValue) {
      showSnackbar('Please fill in all fields', 'warning');
      return;
    }

    setLoading(true);
    try {
      await axiosClient.post(`/api/v1/users/${selectedUser.id}/credentials`, {
        keyName,
        keyValue
      });
      await refetchSelectedUser(selectedUser.id);
      resetCredentialForms();
      setAddCredentialOpen(false);
      showSnackbar('Credential added successfully');
    } catch (err) {
      console.error('[DEBUG] Error adding credential:', err);
      showSnackbar(err.response?.data?.error || 'Failed to add credential', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteCredential(keyName) {
    if (!selectedUser) return;
    if (!window.confirm(`Are you sure you want to delete the credential "${keyName}"?`)) return;
    
    setLoading(true);
    try {
      await axiosClient.delete(`/api/v1/users/${selectedUser.id}/credentials/${keyName}`);
      await refetchSelectedUser(selectedUser.id);
      showSnackbar('Credential deleted successfully');
    } catch (err) {
      console.error('[DEBUG] Error deleting credential:', err);
      showSnackbar(err.response?.data?.error || 'Failed to delete credential', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!selectedUser || !editingCredential) return;
    
    setLoading(true);
    try {
      await axiosClient.put(
        `/api/v1/users/${selectedUser.id}/credentials/${editingCredential.key_name}`,
        { keyValue: editKeyValue }
      );
      await refetchSelectedUser(selectedUser.id);
      resetCredentialForms();
      showSnackbar('Credential updated successfully');
    } catch (err) {
      console.error('[DEBUG] Error updating credential:', err);
      showSnackbar(err.response?.data?.error || 'Failed to update credential', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteUser(userId) {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    setLoading(true);
    try {
      await axiosClient.delete(`/api/v1/users/${userId}`);
      setSelectedUser(null);
      fetchUsers();
      showSnackbar('User deleted successfully');
    } catch (err) {
      console.error('[DEBUG] Error deleting user:', err);
      showSnackbar('Failed to delete user', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function refetchSelectedUser(userId) {
    try {
      const userRes = await axiosClient.get(`/api/v1/users/${userId}`);
      const credRes = await axiosClient.get(`/api/v1/users/${userId}/credentials`);
      setSelectedUser({
        ...userRes.data,
        credentials: credRes.data
      });
    } catch (err) {
      console.error('[DEBUG] Error refreshing user data:', err);
      showSnackbar('Failed to refresh credentials', 'error');
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showSnackbar('Copied to clipboard');
  };

  return (
    <Box sx={{ 
      position: 'relative',
      px: isMobile ? 1 : 2
    }}>
      {loading && (
        <Box sx={{ 
          position: 'fixed', 
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          zIndex: 1000
        }}>
          <CircularProgress />
        </Box>
      )}
      
      <Grid container spacing={isMobile ? 2 : 3}>
        <Grid item xs={12}>
          <Card>
            <CardContent sx={{ p: isMobile ? 2 : 3 }}>
              <Box sx={{ 
                display: 'flex', 
                flexDirection: isMobile ? 'column' : 'row',
                gap: isMobile ? 2 : 0,
                justifyContent: 'space-between', 
                alignItems: isMobile ? 'stretch' : 'center', 
                mb: 2 
              }}>
                <Typography variant={isMobile ? "h6" : "h5"}>
                  Manage Credentials
                </Typography>
                <Button
                  fullWidth={isMobile}
                  variant="contained"
                  startIcon={<RefreshIcon />}
                  onClick={fetchUsers}
                  size={isMobile ? "small" : "medium"}
                >
                  Refresh
                </Button>
              </Box>
              {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            </CardContent>
          </Card>
        </Grid>

        {/* Users List */}
        <Grid item xs={12} md={selectedUser ? 6 : 12}>
          <Card>
            <CardContent sx={{ p: isMobile ? 2 : 3 }}>
              <Typography variant="h6" gutterBottom>
                Users
              </Typography>
              <TableContainer sx={{ 
                maxHeight: isMobile ? '50vh' : '70vh',
                overflowY: 'auto'
              }}>
                <Table 
                  size={isMobile ? "small" : "medium"}
                  sx={{ 
                    '& .MuiTableCell-root': {
                      px: isMobile ? 1 : 2,
                      py: isMobile ? 1 : 1.5,
                      whiteSpace: 'nowrap'
                    }
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell>User</TableCell>
                      {!isMobile && <TableCell>Created</TableCell>}
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id} hover>
                        <TableCell>
                          <Box sx={{ 
                            display: 'flex', 
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 1
                          }}>
                            <Typography 
                              variant="body1"
                              sx={{ 
                                fontSize: isMobile ? '0.875rem' : '1rem',
                                fontWeight: selectedUser?.id === user.id ? 'bold' : 'normal'
                              }}
                            >
                              {user.username}
                            </Typography>
                            <Chip 
                              size="small" 
                              label={`ID: ${user.id}`}
                              sx={{ 
                                height: isMobile ? 20 : 24,
                                '& .MuiChip-label': {
                                  px: 1,
                                  fontSize: isMobile ? '0.7rem' : '0.75rem'
                                }
                              }}
                            />
                          </Box>
                        </TableCell>
                        {!isMobile && (
                          <TableCell>
                            {new Date(user.created_at).toLocaleDateString()}
                          </TableCell>
                        )}
                        <TableCell align="right">
                          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                            <Tooltip title="View Credentials">
                              <IconButton 
                                size={isMobile ? "small" : "medium"}
                                onClick={() => handleViewCredentials(user.id)}
                                color={selectedUser?.id === user.id ? "primary" : "default"}
                              >
                                <ViewIcon fontSize={isMobile ? "small" : "medium"} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete User">
                              <IconButton 
                                size={isMobile ? "small" : "medium"}
                                onClick={() => handleDeleteUser(user.id)}
                                color="error"
                              >
                                <DeleteIcon fontSize={isMobile ? "small" : "medium"} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Credentials Section */}
        {selectedUser && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent sx={{ p: isMobile ? 2 : 3 }}>
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: isMobile ? 'column' : 'row',
                  gap: isMobile ? 2 : 0,
                  justifyContent: 'space-between', 
                  alignItems: isMobile ? 'stretch' : 'center',
                  mb: 2 
                }}>
                  <Typography variant="h6">
                    {selectedUser.username}'s Credentials
                  </Typography>
                  <Button
                    fullWidth={isMobile}
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setAddCredentialOpen(true)}
                    size={isMobile ? "small" : "medium"}
                  >
                    Add Credential
                  </Button>
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" color="textSecondary">
                    API Key
                  </Typography>
                  <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 1,
                    mt: 1
                  }}>
                    <Typography 
                      variant="body2" 
                      sx={{ 
                        fontFamily: 'monospace',
                        bgcolor: 'grey.100',
                        p: isMobile ? 1 : 1.5,
                        borderRadius: 1,
                        flex: 1,
                        fontSize: isMobile ? '0.75rem' : '0.875rem',
                        overflowX: 'auto',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {selectedUser.api_key_plain || 'N/A'}
                    </Typography>
                    <IconButton 
                      size={isMobile ? "small" : "medium"}
                      onClick={() => copyToClipboard(selectedUser.api_key_plain)}
                    >
                      <CopyIcon fontSize={isMobile ? "small" : "medium"} />
                    </IconButton>
                  </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                {!selectedUser.credentials?.length ? (
                  <Typography color="textSecondary" align="center">
                    No credentials found
                  </Typography>
                ) : (
                  <List sx={{ 
                    maxHeight: isMobile ? 'calc(100vh - 400px)' : '60vh',
                    overflowY: 'auto',
                    px: 0
                  }}>
                    {selectedUser.credentials.map((cred) => (
                      <ListItem 
                        key={cred.key_name}
                        sx={{
                          bgcolor: 'background.paper',
                          mb: 1,
                          borderRadius: 1,
                          border: '1px solid',
                          borderColor: 'divider',
                          p: isMobile ? 1 : 2
                        }}
                      >
                        {editingCredential?.key_name === cred.key_name ? (
                          <form onSubmit={handleSaveEdit} style={{ width: '100%' }}>
                            <Grid container spacing={isMobile ? 1 : 2} alignItems="center">
                              <Grid item xs={12} sm={5}>
                                <Typography variant="subtitle2">{cred.key_name}</Typography>
                              </Grid>
                              <Grid item xs={12} sm={5}>
                                <TextField
                                  fullWidth
                                  size="small"
                                  label="Key Value"
                                  value={editKeyValue}
                                  onChange={e => setEditKeyValue(e.target.value)}
                                />
                              </Grid>
                              <Grid item xs={12} sm={2}>
                                <Box sx={{ 
                                  display: 'flex', 
                                  gap: 1,
                                  justifyContent: isMobile ? 'flex-end' : 'center',
                                  mt: isMobile ? 1 : 0
                                }}>
                                  <IconButton 
                                    type="submit" 
                                    color="primary"
                                    size={isMobile ? "small" : "medium"}
                                  >
                                    <SaveIcon fontSize={isMobile ? "small" : "medium"} />
                                  </IconButton>
                                  <IconButton 
                                    onClick={() => setEditingCredential(null)}
                                    size={isMobile ? "small" : "medium"}
                                  >
                                    <CancelIcon fontSize={isMobile ? "small" : "medium"} />
                                  </IconButton>
                                </Box>
                              </Grid>
                            </Grid>
                          </form>
                        ) : (
                          <Box sx={{ width: '100%' }}>
                            <Box sx={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: isMobile ? 'flex-start' : 'center',
                              flexDirection: isMobile ? 'column' : 'row',
                              gap: isMobile ? 1 : 0
                            }}>
                              <Box>
                                <Typography 
                                  variant="subtitle2"
                                  sx={{ fontSize: isMobile ? '0.875rem' : '1rem' }}
                                >
                                  {cred.key_name}
                                </Typography>
                                <Typography 
                                  variant="body2" 
                                  color="textSecondary"
                                  sx={{ fontSize: isMobile ? '0.75rem' : '0.875rem' }}
                                >
                                  {cred.key_value}
                                </Typography>
                              </Box>
                              <Box sx={{ 
                                display: 'flex', 
                                gap: 1,
                                alignSelf: isMobile ? 'flex-end' : 'center'
                              }}>
                                <IconButton 
                                  size={isMobile ? "small" : "medium"}
                                  onClick={() => {
                                    setEditingCredential(cred);
                                    setEditKeyValue(cred.key_value);
                                  }}
                                >
                                  <EditIcon fontSize={isMobile ? "small" : "medium"} />
                                </IconButton>
                                <IconButton 
                                  size={isMobile ? "small" : "medium"}
                                  color="error"
                                  onClick={() => handleDeleteCredential(cred.key_name)}
                                >
                                  <DeleteIcon fontSize={isMobile ? "small" : "medium"} />
                                </IconButton>
                              </Box>
                            </Box>
                          </Box>
                        )}
                      </ListItem>
                    ))}
                  </List>
                )}
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* Add Credential Dialog */}
      <Dialog 
        open={addCredentialOpen} 
        onClose={() => setAddCredentialOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            m: isMobile ? 2 : 3,
            width: isMobile ? 'calc(100% - 32px)' : undefined
          }
        }}
      >
        <DialogTitle sx={{ fontSize: isMobile ? '1.25rem' : '1.5rem' }}>
          Add New Credential
        </DialogTitle>
        <form onSubmit={handleAddCredential}>
          <DialogContent>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Key Name"
                  value={keyName}
                  onChange={e => setKeyName(e.target.value)}
                  required
                  size={isMobile ? "small" : "medium"}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Key Value"
                  value={keyValue}
                  onChange={e => setKeyValue(e.target.value)}
                  required
                  size={isMobile ? "small" : "medium"}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions sx={{ p: isMobile ? 2 : 3 }}>
            <Button 
              onClick={() => setAddCredentialOpen(false)}
              size={isMobile ? "small" : "medium"}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              variant="contained"
              disabled={!keyName || !keyValue}
              size={isMobile ? "small" : "medium"}
            >
              Add Credential
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
        sx={{
          bottom: isMobile ? 16 : 24
        }}
      />
    </Box>
  );
}

export default CredentialsPage;