import React, { useState, useEffect } from 'react';
import { 
  Box, TextField, Button, MenuItem, Select, FormControl, InputLabel, 
  Grid, Card, CardContent, Typography, CardMedia, CardActions, CircularProgress,
  InputAdornment
} from '@mui/material';
import { Search as SearchIcon, Plus, ExternalLink, Sparkles } from 'lucide-react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const hostname = window.location.hostname;

const Search = () => {
  const [sources, setSources] = useState([]);
  const [selectedSource, setSelectedSource] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get(`http://${hostname}:4000/api/extensions`).then(res => {
      setSources(res.data);
      if (res.data.length > 0) setSelectedSource(res.data[0].id);
    });
  }, []);

  const handleSearch = async () => {
    if (!searchTerm) return;
    setLoading(true);
    try {
      const res = await axios.post(`http://${hostname}:4000/api/search`, {
        sourceId: selectedSource,
        searchTerm
      });
      setResults(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddNovel = async (novelPath) => {
    setLoading(true);
    try {
      const res = await axios.post(`http://${hostname}:4000/api/fetch-meta`, {
        sourceId: selectedSource,
        novelPath
      });
      navigate(`/novel/${res.data.slug}`);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <Box sx={{ mb: 6, textAlign: 'center' }}>
        <Typography variant="h4" sx={{ 
          fontWeight: 900, mb: 2,
          background: 'linear-gradient(135deg, #fff 0%, #3b82f6 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          Explore New Worlds
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto' }}>
          Search through premium light novel sources and start your AI-powered translation journey.
        </Typography>
      </Box>

      <Box sx={{ 
        p: 1, mb: 6, borderRadius: 4, 
        bgcolor: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', gap: 1, flexDirection: { xs: 'column', sm: 'row' }
      }}>
        <FormControl sx={{ minWidth: { xs: '100%', sm: 180 } }}>
          <Select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            sx={{ 
              borderRadius: 3, 
              bgcolor: 'transparent',
              '& .MuiOutlinedInput-notchedOutline': { border: 'none' }
            }}
          >
            {sources.map(s => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField 
          fullWidth 
          placeholder="Search for a novel..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon size={20} color="#64748b" />
              </InputAdornment>
            ),
            sx: { borderRadius: 3, '& fieldset': { border: 'none' } }
          }}
          sx={{ bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 3 }}
        />
        <Button 
          variant="contained" 
          onClick={handleSearch} 
          disabled={loading}
          sx={{ 
            px: 4, borderRadius: 3, 
            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
            height: { xs: 50, sm: 'auto' }
          }}
        >
          {loading ? <CircularProgress size={24} color="inherit" /> : 'Search'}
        </Button>
      </Box>

      <Grid container spacing={3}>
        <AnimatePresence>
          {results.map((novel, idx) => (
            <Grid item xs={12} key={idx}>
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card sx={{ 
                  display: 'flex', borderRadius: 4, overflow: 'hidden',
                  bgcolor: 'rgba(255,255,255,0.02)',
                  transition: 'all 0.3s',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.05)', transform: 'translateY(-2px)' }
                }}>
                  <CardMedia
                    component="img"
                    sx={{ width: { xs: 100, sm: 140 }, height: { xs: 150, sm: 200 }, objectFit: 'cover' }}
                    image={novel.cover}
                    alt={novel.name}
                    onError={(e) => { e.target.src = 'https://via.placeholder.com/300x450?text=No+Cover'; }}
                  />
                  <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, p: { xs: 2, sm: 3 } }}>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="h6" fontWeight="700" sx={{ mb: 1, lineHeight: 1.2 }}>
                        {novel.name}
                      </Typography>
                      <Typography variant="body2" color="primary" fontWeight="600" sx={{ mb: 2 }}>
                        {novel.author}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button 
                        variant="outlined" 
                        startIcon={<Plus size={18} />}
                        onClick={() => handleAddNovel(novel.path)}
                        sx={{ borderRadius: 2, borderWidth: 2, '&:hover': { borderWidth: 2 } }}
                      >
                        Add to Library
                      </Button>
                    </Box>
                  </Box>
                </Card>
              </motion.div>
            </Grid>
          ))}
        </AnimatePresence>
      </Grid>
      
      {!loading && results.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 10, opacity: 0.3 }}>
          <Sparkles size={64} style={{ marginBottom: 16 }} />
          <Typography variant="h6">Try searching for something exciting!</Typography>
        </Box>
      )}
    </Box>
  );
};

export default Search;
