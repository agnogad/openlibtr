import React, { useState, useEffect } from 'react';
import { 
  Box, Typography, Button, TextField, Grid, Card, CardContent, 
  CardMedia, Divider, Chip, List, ListItem, ListItemText, ListItemIcon, CircularProgress,
  Paper, IconButton, Stack
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Play, Info, Book, User, Hash, Languages, Cpu } from 'lucide-react';
import axios from 'axios';
import { motion } from 'framer-motion';

const hostname = window.location.hostname;

const NovelDetail = () => {
  const { slug } = useParams();
  const [novel, setNovel] = useState(null);
  const [count, setCount] = useState(5);
  const [processing, setProcessing] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchNovel();
  }, [slug]);

  const fetchNovel = async () => {
    try {
      const res = await axios.get(`http://${hostname}:4000/api/novel/${slug}`);
      setNovel(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const startProcess = async () => {
    setProcessing(true);
    try {
      await axios.post(`http://${hostname}:4000/api/process`, {
        sourceId: novel.source,
        novelSlug: slug,
        novelPath: novel.path,
        count: parseInt(count)
      });
      navigate('/tasks');
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setProcessing(false);
    }
  };

  if (!novel) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
      <CircularProgress thickness={5} size={60} />
    </Box>
  );

  const genres = Array.isArray(novel.genres) ? novel.genres : (typeof novel.genres === 'string' ? novel.genres.split(',') : []);

  return (
    <Box>
      {/* Hero Section */}
      <Box sx={{ position: 'relative', mb: { xs: 4, md: 8 }, borderRadius: { xs: 0, md: 8 }, overflow: 'hidden' }}>
        <Box sx={{ 
          position: 'absolute', inset: 0, 
          backgroundImage: `url(http://${hostname}:4000/covers/${slug}/cover.jpg)`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          filter: 'blur(60px) brightness(0.3)', transform: 'scale(1.1)'
        }} />
        
        <Box sx={{ position: 'relative', p: { xs: 3, md: 6 }, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 4 }}>
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
            <Card sx={{ 
              width: { xs: 200, md: 280 }, mx: { xs: 'auto', md: 0 },
              borderRadius: 4, boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              <CardMedia
                component="img"
                image={`http://${hostname}:4000/covers/${slug}/cover.jpg`}
                onError={(e) => { e.target.src = 'https://via.placeholder.com/300x450?text=No+Cover'; }}
              />
            </Card>
          </motion.div>

          <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Button 
              onClick={() => navigate('/')}
              startIcon={<ChevronLeft size={20} />}
              sx={{ alignSelf: 'flex-start', mb: 2, color: 'white', opacity: 0.6, '&:hover': { opacity: 1 } }}
            >
              Back to Collection
            </Button>
            <Typography variant="h3" fontWeight="900" sx={{ mb: 1, textShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
              {novel.name}
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mb: 3, opacity: 0.8 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <User size={16} color="#3b82f6" />
                <Typography variant="subtitle1" fontWeight="600">{novel.author || 'Unknown Author'}</Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Languages size={16} color="#8b5cf6" />
                <Typography variant="subtitle1" fontWeight="600">English to Turkish</Typography>
              </Stack>
            </Stack>
            
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 4 }}>
              {genres.map((g, i) => (
                <Chip key={i} label={g.trim()} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)', fontWeight: 600 }} />
              ))}
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <Paper sx={{ 
                p: 0.5, borderRadius: 3, display: 'flex', alignItems: 'center', 
                bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <TextField 
                  type="number" 
                  value={count} 
                  onChange={(e) => setCount(e.target.value)}
                  variant="standard"
                  InputProps={{ 
                    disableUnderline: true,
                    sx: { px: 2, width: 80, fontWeight: 800, fontSize: '1.2rem' } 
                  }}
                />
                <Button 
                  variant="contained" 
                  startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <Play size={20} fill="currentColor" />}
                  onClick={startProcess} 
                  disabled={processing}
                  sx={{ borderRadius: 2.5, px: 4, py: 1.5, fontWeight: 800 }}
                >
                  START AI ENGINE
                </Button>
              </Paper>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Content Section */}
      <Grid container spacing={4}>
        <Grid item xs={12} md={7}>
          <Box sx={{ mb: 4 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <Info size={20} color="#3b82f6" />
              <Typography variant="h6" fontWeight="800">Synopsis</Typography>
            </Stack>
            <Typography variant="body1" sx={{ color: 'text.secondary', lineHeight: 1.8, whiteSpace: 'pre-line' }}>
              {novel.summary}
            </Typography>
          </Box>
        </Grid>

        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, borderRadius: 6, bgcolor: 'rgba(255,255,255,0.02)' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 3 }}>
              <Book size={20} color="#3b82f6" />
              <Typography variant="h6" fontWeight="800">Local Archive</Typography>
              <Chip label={novel.chapterFiles?.length || 0} size="small" sx={{ ml: 'auto', fontWeight: 800 }} />
            </Stack>
            
            <List sx={{ maxHeight: 400, overflow: 'auto', pr: 1 }}>
              {novel.chapterFiles?.length > 0 ? (
                novel.chapterFiles.map((ch, idx) => (
                  <ListItem key={idx} sx={{ 
                    mb: 1, borderRadius: 3, 
                    bgcolor: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.02)'
                  }}>
                    <ListItemIcon sx={{ minWidth: 40 }}><Hash size={16} /></ListItemIcon>
                    <ListItemText primary={ch.name} primaryTypographyProps={{ fontWeight: 600, fontSize: '0.9rem' }} />
                  </ListItem>
                ))
              ) : (
                <Box sx={{ textAlign: 'center', py: 4, opacity: 0.3 }}>
                  <Cpu size={48} style={{ marginBottom: 8 }} />
                  <Typography variant="body2">No local data found.</Typography>
                </Box>
              )}
            </List>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default NovelDetail;
