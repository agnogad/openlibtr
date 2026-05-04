import React, { useState, useEffect } from 'react';
import { 
  Box, Typography, List, ListItem, ListItemText, LinearProgress, 
  Paper, Divider, Chip, IconButton, Stack
} from '@mui/material';
import { Activity, CheckCircle2, AlertCircle, Loader2, Scroll, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ActiveTasks = ({ socket }) => {
  const [tasks, setTasks] = useState({});

  useEffect(() => {
    const hostname = window.location.hostname;
    // Initial fetch
    fetch(`http://${hostname}:4000/api/active-tasks`)
      .then(res => res.json())
      .then(data => setTasks(data));

    socket.on('task-started', ({ novelSlug, total }) => {
      setTasks(prev => ({
        ...prev,
        [novelSlug]: { status: 'running', current: 0, total, logs: ['Process initialized...'] }
      }));
    });

    socket.on('task-progress', ({ novelSlug, current, total, chapterNum, chapterName }) => {
      setTasks(prev => {
        const task = prev[novelSlug] || { logs: [] };
        return {
          ...prev,
          [novelSlug]: {
            ...task,
            current,
            total,
            status: 'running',
            lastChapter: `Chapter ${chapterNum}: ${chapterName}`,
            logs: [`Done: Ch ${chapterNum}`, ...(task.logs || []).slice(0, 5)]
          }
        };
      });
    });

    socket.on('task-completed', ({ novelSlug }) => {
      setTasks(prev => {
        const newState = { ...prev };
        delete newState[novelSlug];
        return newState;
      });
    });

    return () => {
      socket.off('task-started');
      socket.off('task-progress');
      socket.off('task-completed');
    };
  }, [socket]);

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Box sx={{ mb: 6, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Activity size={32} color="#3b82f6" />
        <Box>
          <Typography variant="h4" fontWeight="800">Process Monitor</Typography>
          <Typography variant="body2" color="text.secondary">Real-time status of your AI translation tasks.</Typography>
        </Box>
      </Box>

      <AnimatePresence>
        {Object.keys(tasks).length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 6, bgcolor: 'rgba(255,255,255,0.01)' }}>
              <CheckCircle2 size={48} color="#10b981" style={{ marginBottom: 16, opacity: 0.5 }} />
              <Typography variant="h6" color="text.secondary">All systems clear. No active tasks.</Typography>
            </Paper>
          </motion.div>
        ) : (
          Object.entries(tasks).map(([slug, task]) => (
            <motion.div
              key={slug}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              layout
            >
              <Paper sx={{ p: 3, mb: 3, borderRadius: 5, overflow: 'hidden', position: 'relative' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
                  <Box>
                    <Typography variant="h6" fontWeight="700" sx={{ mb: 0.5 }}>{slug.replace(/-/g, ' ').toUpperCase()}</Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Loader2 size={14} className="animate-spin" color="#3b82f6" />
                      <Typography variant="caption" color="primary" fontWeight="700">TRANSLATING</Typography>
                    </Stack>
                  </Box>
                  <Chip 
                    label={`${Math.round((task.current / task.total) * 100)}%`} 
                    color="primary" 
                    variant="filled"
                    sx={{ fontWeight: 800, borderRadius: 2 }} 
                  />
                </Box>

                <Box sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" fontWeight="600" color="text.secondary">
                      {task.lastChapter || 'Analyzing metadata...'}
                    </Typography>
                    <Typography variant="caption" fontWeight="700">
                      {task.current} / {task.total}
                    </Typography>
                  </Box>
                  <LinearProgress 
                    variant="determinate" 
                    value={(task.current / task.total) * 100} 
                    sx={{ height: 8, borderRadius: 4, bgcolor: 'rgba(255,255,255,0.05)' }}
                  />
                </Box>

                <Box sx={{ bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 3, p: 2 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, opacity: 0.5 }}>
                    <Terminal size={14} />
                    <Typography variant="caption" fontWeight="700">LIVE CONSOLE</Typography>
                  </Stack>
                  {(task.logs || []).map((log, i) => (
                    <Typography key={i} variant="caption" sx={{ display: 'block', fontFamily: 'monospace', opacity: 1 - i * 0.15 }}>
                      {`> ${log}`}
                    </Typography>
                  ))}
                </Box>
              </Paper>
            </motion.div>
          ))
        )}
      </AnimatePresence>
      
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 2s linear infinite; }
      `}</style>
    </Box>
  );
};

export default ActiveTasks;
