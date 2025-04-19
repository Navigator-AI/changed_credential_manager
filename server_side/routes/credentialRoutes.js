// server_side/routes/credentialRoutes.js

const express = require('express');
const router = express.Router();
const credentialController = require('../controllers/credentialController');

// Log all credential requests
router.use('/users/:userId/credentials', (req, res, next) => {
  console.log('[DEBUG] Credential request:', {
    method: req.method,
    path: req.path,
    userId: req.params.userId,
    keyName: req.params.keyName
  });
  next();
});

// Get all credentials for a user
router.get('/users/:userId/credentials', credentialController.listCredentials);

// Get a specific credential
router.get('/users/:userId/credentials/:keyName', credentialController.getCredential);

// Add a new credential
router.post('/users/:userId/credentials', credentialController.addCredential);

// Update a credential
router.put('/users/:userId/credentials/:keyName', credentialController.updateCredential);

// Delete a credential
router.delete('/users/:userId/credentials/:keyName', credentialController.deleteCredential);

module.exports = router;