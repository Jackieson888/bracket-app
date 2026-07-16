"use client";
import {
  styled,
  Stack,
  Typography,
  Divider,
  Box,
  Button,
  Card,
  CardContent,
  TextField,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";

const VisuallyHiddenInput = styled("input")({
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  overflow: "hidden",
  position: "absolute",
  bottom: 0,
  left: 0,
  whiteSpace: "nowrap",
  width: 1,
});

export default function BracketItemForm() {
  return (
    <Card>
      <CardContent>
        <Typography gutterBottom variant="h5" component="div">
          Bracket Item
        </Typography>
        <Divider />
        <Box
          component="form"
          autoComplete="off"
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            width: "24em",
          }}
        >
          <Stack spacing={3}>
            <TextField
              id="title-input"
              label="Title"
              helperText="(e.g. 'Title Example')"
              fullWidth
            />
          </Stack>
          <Stack spacing={3}>
            <TextField
              id="subtitle-input"
              label="Subtitle"
              helperText="(e.g. 'Subtitle Example')"
              fullWidth
            />
          </Stack>
          <Stack spacing={3}>
            <Typography gutterBottom variant="body2">
              Media Upload
            </Typography>
            <Button
              component="label"
              role={undefined}
              variant="contained"
              tabIndex={-1}
              color="warning"
              startIcon={<CloudUploadIcon />}
            >
              Upload Media File
              <VisuallyHiddenInput
                type="file"
                onChange={(event) => console.log(event.target.files)}
              />
            </Button>
            <Divider
              sx={{ bgcolor: (theme) => theme.palette.secondary.main }}
            />

            <Button variant="contained" size="large">
              Create Bracket Item
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}
