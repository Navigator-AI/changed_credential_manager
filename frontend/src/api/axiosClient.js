import axios from 'axios';

// If your server is on port 8086:
const axiosClient = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8050',
  headers: {
    'Content-Type': 'application/json'
  }
});

export default axiosClient;