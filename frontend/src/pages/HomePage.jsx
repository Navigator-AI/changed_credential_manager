import React from 'react';
import { Typography, Box, Paper, Grid, Card, CardContent, Button, useTheme, useMediaQuery } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PeopleIcon from '@mui/icons-material/People';
import VpnKeyIcon from '@mui/icons-material/VpnKey';

function HomePage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const features = [
    {
      title: 'Manage Users',
      description: 'Add, edit, and manage user accounts with ease.',
      icon: <PeopleIcon sx={{ fontSize: isMobile ? 32 : 40, color: '#1976d2' }} />,
      path: '/users'
    },
    {
      title: 'Add New Users',
      description: 'Quickly create new user accounts with proper credentials.',
      icon: <PersonAddIcon sx={{ fontSize: isMobile ? 32 : 40, color: '#1976d2' }} />,
      path: '/add-user'
    },
    {
      title: 'Credential Management',
      description: 'Securely manage and update user credentials.',
      icon: <VpnKeyIcon sx={{ fontSize: isMobile ? 32 : 40, color: '#1976d2' }} />,
      path: '/credentials'
    }
  ];

  return (
    <Box sx={{ px: isMobile ? 2 : 0 }}>
      <Paper 
        elevation={0} 
        sx={{ 
          p: isMobile ? 3 : 4, 
          mb: 4, 
          backgroundColor: '#f8f9fa',
          borderRadius: 2
        }}
      >
        <Typography 
          variant={isMobile ? "h4" : "h3"} 
          gutterBottom 
          sx={{ 
            fontWeight: 'bold',
            color: '#1976d2',
            mb: 2,
            fontSize: isMobile ? '2rem' : '3rem',
            wordBreak: 'break-word'
          }}
        >
          Welcome to Credential Manager
        </Typography>
        <Typography 
          variant={isMobile ? "body1" : "h6"}
          sx={{ 
            color: '#666',
            maxWidth: '800px',
            lineHeight: 1.6,
            fontSize: isMobile ? '1rem' : '1.25rem'
          }}
        >
          Our solution for managing user credentials and database access in our Workspace. 
          To streamline our workflow with secure credential management system.
        </Typography>
      </Paper>

      <Grid container spacing={isMobile ? 2 : 3}>
        {features.map((feature, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <Card 
              sx={{ 
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                transition: 'transform 0.2s',
                '&:hover': {
                  transform: isMobile ? 'none' : 'translateY(-5px)',
                  boxShadow: 3
                },
                '&:active': {
                  transform: isMobile ? 'scale(0.98)' : 'none'
                }
              }}
            >
              <CardContent sx={{ 
                flexGrow: 1, 
                textAlign: 'center', 
                p: isMobile ? 2 : 3,
                display: 'flex',
                flexDirection: 'column',
                gap: isMobile ? 1 : 2
              }}>
                <Box sx={{ mb: isMobile ? 1 : 2 }}>
                  {feature.icon}
                </Box>
                <Typography 
                  variant={isMobile ? "h6" : "h5"} 
                  gutterBottom 
                  sx={{ 
                    fontWeight: 'bold',
                    fontSize: isMobile ? '1.1rem' : '1.5rem'
                  }}
                >
                  {feature.title}
                </Typography>
                <Typography 
                  variant="body1" 
                  sx={{ 
                    mb: isMobile ? 2 : 3, 
                    color: '#666',
                    fontSize: isMobile ? '0.9rem' : '1rem'
                  }}
                >
                  {feature.description}
                </Typography>
                <Button 
                  variant="contained" 
                  onClick={() => navigate(feature.path)}
                  sx={{
                    textTransform: 'none',
                    px: isMobile ? 3 : 4,
                    py: isMobile ? 0.5 : 1,
                    mt: 'auto'
                  }}
                >
                  Get Started
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

export default HomePage;