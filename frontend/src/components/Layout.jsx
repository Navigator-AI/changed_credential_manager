import React, { useState } from 'react';
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  Container, 
  Button, 
  Box,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemText,
  useTheme,
  useMediaQuery,
  alpha
} from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';

// Modern color palette
const colors = {
  primary: '#2c3e50', // Dark blue-gray
  secondary: '#3498db', // Bright blue
  accent: '#e74c3c', // Coral red
  background: '#ecf0f1', // Light gray
  text: '#2c3e50', // Dark blue-gray
  lightText: '#ffffff',
  hover: '#34495e' // Darker blue-gray
};

function Layout({ children }) {
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigationItems = [
    { path: '/', label: 'Home' },
    { path: '/users', label: 'Users' },
    { path: '/add-user', label: 'Add User' },
    { path: '/credentials', label: 'Credentials' }
  ];

  const isActive = (path) => location.pathname === path;

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const buttonStyle = (path) => ({
    mx: isTablet ? 0.5 : 1,
    color: colors.lightText,
    position: 'relative',
    borderRadius: '4px',
    fontSize: isTablet ? '0.875rem' : '1rem',
    minWidth: isTablet ? 'auto' : undefined,
    px: isTablet ? 1.5 : 2,
    py: 1,
    transition: 'all 0.3s ease-in-out',
    overflow: 'hidden',
    '&::before': {
      content: '""',
      position: 'absolute',
      bottom: 0,
      left: 0,
      width: isActive(path) ? '100%' : '0%',
      height: '2px',
      backgroundColor: colors.lightText,
      transition: 'width 0.3s ease-in-out'
    },
    '&:hover': {
      backgroundColor: alpha(colors.lightText, 0.1),
      transform: 'translateY(-2px)',
      '&::before': {
        width: '100%'
      }
    },
    '&:active': {
      transform: 'translateY(1px)'
    }
  });

  const renderNavigationItems = () => (
    navigationItems.map(({ path, label }) => (
      <Button
        key={path}
        sx={buttonStyle(path)}
        component={Link}
        to={path}
        onClick={isMobile ? handleDrawerToggle : undefined}
      >
        {label}
      </Button>
    ))
  );

  const drawer = (
    <Box 
      sx={{ 
        width: 250, 
        pt: 2,
        background: colors.background,
        height: '100%'
      }}
    >
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        px: 2, 
        mb: 2 
      }}>
        <Typography 
          variant="h6" 
          sx={{ 
            color: colors.primary,
            fontWeight: 600
          }}
        >
          Menu
        </Typography>
        <IconButton 
          onClick={handleDrawerToggle} 
          sx={{ 
            color: colors.primary,
            transition: 'transform 0.2s ease',
            '&:hover': {
              transform: 'rotate(90deg)'
            }
          }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <List>
        {navigationItems.map(({ path, label }) => (
          <ListItem 
            key={path} 
            onClick={handleDrawerToggle}
            sx={{
              mb: 1,
              mx: 1,
              borderRadius: '8px',
              transition: 'all 0.2s ease-in-out',
              backgroundColor: isActive(path) 
                ? alpha(colors.secondary, 0.1) 
                : 'transparent',
              '&:hover': {
                backgroundColor: alpha(colors.secondary, 0.05),
                transform: 'translateX(4px)'
              }
            }}
          >
            <ListItemText>
              <Link 
                to={path} 
                style={{ 
                  textDecoration: 'none',
                  color: isActive(path) ? colors.secondary : colors.text,
                  fontWeight: isActive(path) ? 600 : 400,
                  display: 'block',
                  width: '100%',
                  padding: '8px 12px',
                  transition: 'all 0.2s ease'
                }}
              >
                {label}
              </Link>
            </ListItemText>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ 
      display: 'flex', 
      flexDirection: 'column', 
      minHeight: '100vh',
      background: colors.background
    }}>
      <AppBar 
        position="static" 
        sx={{ 
          backgroundColor: colors.primary,
          backgroundImage: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.hover} 100%)`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          transition: 'all 0.3s ease'
        }}
      >
        <Toolbar sx={{ 
          justifyContent: 'space-between',
          py: { xs: 1, md: 1.5 }
        }}>
          <Typography 
            variant={isMobile ? "h6" : "h5"} 
            sx={{ 
              fontWeight: 'bold',
              letterSpacing: '0.5px',
              fontSize: {
                xs: '1.1rem',
                sm: '1.25rem',
                md: '1.5rem'
              },
              background: `linear-gradient(45deg, ${colors.lightText} 30%, ${alpha(colors.lightText, 0.8)} 90%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              transition: 'all 0.3s ease'
            }}
          >
            Credential Manager
          </Typography>

          {isMobile ? (
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="end"
              onClick={handleDrawerToggle}
              sx={{
                transition: 'transform 0.2s ease',
                '&:hover': {
                  transform: 'scale(1.1)'
                },
                '&:active': {
                  transform: 'scale(0.95)'
                }
              }}
            >
              <MenuIcon />
            </IconButton>
          ) : (
            <Box sx={{ 
              display: 'flex', 
              gap: { sm: 0.5, md: 1 },
              alignItems: 'center'
            }}>
              {renderNavigationItems()}
            </Box>
          )}
        </Toolbar>
      </AppBar>

      <Drawer
        variant="temporary"
        anchor="right"
        open={mobileOpen}
        onClose={handleDrawerToggle}
        ModalProps={{
          keepMounted: true
        }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { 
            boxSizing: 'border-box',
            width: 250,
            boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
            border: 'none'
          },
          '& .MuiBackdrop-root': {
            backgroundColor: 'rgba(0,0,0,0.2)',
            backdropFilter: 'blur(4px)'
          }
        }}
      >
        {drawer}
      </Drawer>

      <Container 
        sx={{ 
          mt: { xs: 2, sm: 3, md: 4 }, 
          mb: { xs: 2, sm: 3, md: 4 },
          px: { xs: 2, sm: 3 },
          flex: 1,
          position: 'relative',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'radial-gradient(circle at top right, rgba(52, 152, 219, 0.05) 0%, transparent 70%)',
            pointerEvents: 'none'
          }
        }}
      >
        {children}
      </Container>
    </Box>
  );
}

export default Layout;