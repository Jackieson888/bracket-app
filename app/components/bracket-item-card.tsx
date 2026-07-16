import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";

export default function BracketItemCard({ item }) {
  return (
    <Card sx={{ display: "flex" }}>
      <Box sx={{ display: "flex", flexDirection: "column" }}>
        <CardContent>
          <Typography variant="h5">{item.title}</Typography>
        </CardContent>
      </Box>

      {item.imageUrl && (
        <CardMedia
          component="img"
          sx={{ width: 200 }}
          image={item.imageUrl}
          alt={item.title}
        />
      )}
    </Card>
  );
}
