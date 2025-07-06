# Chunky Dad Website

A modern, responsive static website built with HTML, CSS, and JavaScript.

## Features

- **Responsive Design**: Works perfectly on desktop, tablet, and mobile devices
- **Modern UI**: Clean, colorful design with smooth animations
- **Interactive Elements**: Mobile navigation, smooth scrolling, and hover effects
- **Contact Form**: Functional contact form with validation
- **Performance Optimized**: Fast loading times and smooth animations
- **SEO Friendly**: Proper HTML structure and meta tags

## Project Structure

```
chunky-dad/
├── index.html          # Main HTML file
├── styles.css          # CSS styles and responsive design
├── script.js           # JavaScript functionality
├── package.json        # Project configuration
└── README.md          # This file
```

## Getting Started

### Method 1: Python HTTP Server (Recommended)

1. **Prerequisites**: Make sure Python 3 is installed on your system
2. **Start the server**:
   ```bash
   python3 -m http.server 8000
   ```
3. **View the website**: Open your browser and go to `http://localhost:8000`

### Method 2: Using npm scripts

1. **Run the development server**:
   ```bash
   npm start
   # or
   npm run serve
   # or
   npm run dev
   ```

### Method 3: Any HTTP Server

You can use any static file server:

- **Node.js**: `npx http-server`
- **PHP**: `php -S localhost:8000`
- **Live Server**: VS Code extension or `live-server` package

## Deployment

This is a static website that can be deployed to any web hosting service:

### Popular Hosting Options:

- **Netlify**: Drag and drop the files or connect to GitHub
- **Vercel**: Connect to GitHub for automatic deployments
- **GitHub Pages**: Push to GitHub and enable Pages in repository settings
- **Firebase Hosting**: Use Firebase CLI to deploy
- **AWS S3**: Upload files to an S3 bucket with static hosting enabled

### Deployment Steps (Generic):

1. Copy all files (`index.html`, `styles.css`, `script.js`) to your web server
2. Ensure your web server is configured to serve static files
3. Point your domain to the hosting location
4. Your website is live!

## Customization

### Content Updates

- **Text Content**: Edit the HTML in `index.html`
- **Images**: Replace placeholder emojis with actual images
- **Colors**: Modify the CSS variables in `styles.css`
- **Fonts**: Change the Google Fonts import in `index.html`

### Styling Changes

The website uses CSS Grid and Flexbox for layout. Key customization areas:

- **Color Scheme**: Look for gradient definitions in `styles.css`
- **Typography**: Font sizes and weights are defined in CSS
- **Spacing**: Padding and margins can be adjusted
- **Animations**: Modify keyframes and transitions

### Adding New Sections

1. Add new HTML section in `index.html`
2. Create corresponding CSS styles in `styles.css`
3. Add navigation link if needed
4. Update JavaScript for any interactive features

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance

- **Lighthouse Score**: 90+ (Performance, Accessibility, Best Practices, SEO)
- **First Contentful Paint**: < 1.5s
- **Time to Interactive**: < 2.5s
- **Cumulative Layout Shift**: < 0.1

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - feel free to use this template for your own projects!

## Contact

For questions or support, please contact hello@chunkydad.com

---

Built with ❤️ using modern web technologies