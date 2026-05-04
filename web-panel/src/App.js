import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { 
  AppBar, Toolbar, Typography, Drawer, List, ListItem, ListItemIcon, ListItemText, 
  Box, Badge
} from '@mui/material';
import { 
  Library, 
  Search as SearchIcon, 
  Activity,
  Home as HomeIcon
} from 'lucide-react';
import { BottomNavigation, BottomNavigationAction, Paper as MuiPaper } from '@mui/material';
import io from 'socket.io-client';

import LibraryComp from './components/Library';
import Search from './components/Search';
import ActiveTasks from './components/ActiveTasks';
import NovelDetail from './components/NovelDetail';

const drawerWidth = 260;
const hostname = window.location.hostname;
const socket = io(`http://${hostname}:4000`);

function App() {
  const [activeTasksCount, setActiveTasksCount] = useState(0);
  const [bottomNavValue, setBottomNavValue] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    socket.on('task-started', () => setActiveTasksCount(prev => prev + 1));
    socket.on('task-completed', () => setActiveTasksCount(prev => Math.max(0, prev - 1)));
    socket.on('task-failed', () => setActiveTasksCount(prev => Math.max(0, prev - 1)));
    return () => {
      socket.off('task-started');
      socket.off('task-completed');
      socket.off('task-failed');
    };
  }, []);

  const drawer = (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2, py: 3, mb: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ 
          width: 40, height: 40, borderRadius: 3, 
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)'
        }}>
          <HomeIcon color="white" size={20} />
        </Box>
        <Typography variant="h6" fontWeight="800" letterSpacing="-0.5px">
          NOVEL<Box component="span" sx={{ color: 'primary.main' }}>AI</Box>
        </Typography>
      </Box>
      
      <List sx={{ flexGrow: 1 }}>
        {[
          { text: 'Library', icon: <Library size={20} />, path: '/' },
          { text: 'Discovery', icon: <SearchIcon size={20} />, path: '/search' },
          { text: 'Ongoing', icon: <Activity size={20} />, path: '/tasks', badge: activeTasksCount },
        ].map((item) => (
          <ListItem 
            button 
            key={item.text} 
            component={Link} 
            to={item.path}
            sx={{ 
              borderRadius: 3, mb: 1, 
              color: 'text.secondary',
              transition: 'all 0.2s',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.05)', color: 'white' },
              '&.active': { bgcolor: 'primary.main', color: 'white' }
            }}
          >
            <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: 600, fontSize: '0.9rem' }} />
            {item.badge > 0 && (
              <Box sx={{ 
                bgcolor: 'error.main', color: 'white', px: 1, borderRadius: 10, 
                fontSize: '0.7rem', fontWeight: 700 
              }}>
                {item.badge}
              </Box>
            )}
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', bgcolor: 'background.default', minHeight: '100vh' }}>
      <AppBar 
        position="fixed" 
        elevation={0}
        sx={{ 
          zIndex: (theme) => theme.zIndex.drawer + 1,
          bgcolor: 'rgba(2, 6, 23, 0.7)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: { xs: 'none', sm: 'block' }
        }}
      >
        <Toolbar>
          <Typography variant="h6" fontWeight="bold">Dashboard</Typography>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 }, display: { xs: 'none', sm: 'block' } }}
      >
        <Drawer
          variant="permanent"
          sx={{
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth, borderRight: '1px solid rgba(255,255,255,0.05)', bgcolor: 'background.default' },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{ 
          flexGrow: 1, 
          p: { xs: 2, sm: 4 }, 
          width: { sm: `calc(100% - ${drawerWidth}px)` }, 
          maxWidth: '100%',
          overflowX: 'hidden',
          mt: { xs: 0, sm: 8 },
          mb: { xs: 8, sm: 0 } 
        }}
      >
        <Routes>
          <Route path="/" element={<LibraryComp />} />
          <Route path="/library" element={<LibraryComp />} />
          <Route path="/search" element={<Search />} />
          <Route path="/tasks" element={<ActiveTasks socket={socket} />} />
          <Route path="/novel/:slug" element={<NovelDetail />} />
        </Routes>
      </Box>

      <MuiPaper sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, display: { xs: 'block', sm: 'none' }, zIndex: 1000 }} elevation={3}>
        <BottomNavigation
          showLabels
          value={bottomNavValue}
          onChange={(event, newValue) => {
            setBottomNavValue(newValue);
            if (newValue === 0) navigate('/');
            if (newValue === 1) navigate('/search');
            if (newValue === 2) navigate('/tasks');
          }}
        >
          <BottomNavigationAction label="Library" icon={<Library size={20} />} />
          <BottomNavigationAction label="Search" icon={<SearchIcon size={20} />} />
          <BottomNavigationAction 
            label="Tasks" 
            icon={<Badge badgeContent={activeTasksCount} color="error"><Activity size={20} /></Badge>} 
          />
        </BottomNavigation>
      </MuiPaper>
    </Box>
  );
}

export default App;
