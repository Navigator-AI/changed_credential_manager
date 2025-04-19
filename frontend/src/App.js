// frontend/src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import UsersListPage from './pages/UsersListPage';
import AddUserPage from './pages/AddUserPage';
import ManageUserPage from './pages/ManageUserPage';
import CredentialsPage from './pages/CredentialsPage';

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/users" element={<UsersListPage />} />
          <Route path="/users/:id" element={<ManageUserPage />} />
          <Route path="/add-user" element={<AddUserPage />} />
          <Route path="/credentials" element={<CredentialsPage />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;