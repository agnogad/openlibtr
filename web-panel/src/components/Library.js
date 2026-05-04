import React, { useState, useEffect } from 'react';
import { 
  Typography, Box, CircularProgress, Button
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { RefreshCw, BookOpen } from 'lucide-react';

const Library = () => {
  const [novels, setNovels] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchLibrary = async () => {
    try {
      setLoading(true);
      const hostname = window.location.hostname || 'localhost';
      const url = `http://${hostname}:4000/api/library`;
      console.log("Fetching from:", url);
      const res = await axios.get(url);
      console.log("Data count:", res.data.length);
      setNovels(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Fetch error:", err);
      alert("API Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLibrary();
  }, []);

  if (loading) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <CircularProgress />
      <Typography sx={{ mt: 2 }}>Veriler Yükleniyor...</Typography>
    </Box>
  );

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" fontWeight="bold" color="white">Kütüphane</Typography>
          <Typography variant="body2" color="primary">{novels.length} Kitap Bulundu</Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshCw size={18} />} onClick={fetchLibrary}>Yenile</Button>
      </Box>

      {novels.length === 0 ? (
        <Box sx={{ p: 10, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 4 }}>
          <Typography color="text.secondary">Kütüphane boş görünüyor.</Typography>
        </Box>
      ) : (
        <Box sx={{ 
          display: 'grid', 
          gridTemplateColumns: {
            xs: '1fr 1fr',
            sm: '1fr 1fr 1fr',
            md: '1fr 1fr 1fr 1fr',
            lg: '1fr 1fr 1fr 1fr 1fr 1fr'
          }, 
          gap: { xs: 2, sm: 3 }
        }}>
          {novels.map((novel) => (
            <Box 
              key={novel.slug} 
              onClick={() => navigate(`/novel/${novel.slug}`)}
              sx={{ 
                bgcolor: '#1e293b', 
                borderRadius: 3, 
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                flexDirection: 'column',
                transition: 'transform 0.1s',
                '&:active': { transform: 'scale(0.95)' }
              }}
            >
              <Box sx={{ width: '100%', pt: '150%', position: 'relative' }}>
                <img 
                  src={`http://${window.location.hostname || 'localhost'}:4000/covers/${novel.slug}/cover.jpg`}
                  alt={novel.title}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => { e.target.src = 'https://via.placeholder.com/300x450?text=Kapak+Yok'; }}
                />
              </Box>
              <Box sx={{ p: 1.5, flexGrow: 1 }}>
                <Typography variant="caption" color="primary" sx={{ display: 'block', mb: 0.5, fontWeight: 'bold' }}>
                  {novel.chapterCount} BÖLÜM
                </Typography>
                <Typography variant="body2" fontWeight="bold" sx={{ 
                  color: 'white',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', 
                  overflow: 'hidden', height: '2.8em', lineHeight: 1.2
                }}>
                  {novel.title}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default Library;
