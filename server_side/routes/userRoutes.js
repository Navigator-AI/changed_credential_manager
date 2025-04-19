const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Log all user requests
router.use('/', (req, res, next) => {
  console.log('[DEBUG] User request:', {
    method: req.method,
    path: req.path,
    params: req.params,
    query: req.query,
    body: req.body
  });
  next();
});

// List all users
router.get('/', userController.listUsers);

// Get user by ID
router.get('/:id', userController.getUserById);

// Add new user
router.post('/', userController.addUser);

// Delete user
router.delete('/:id', userController.deleteUser);

module.exports = router;