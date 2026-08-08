/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.externals.push({
      "fluent-ffmpeg": "commonjs fluent-ffmpeg",
    });
    return config;
  },
};

module.exports = nextConfig;
