import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    webpack: (config) => {
        config.output.chunkFilename = config.output.chunkFilename.replace(/[%@]/g, "_");
        return config;
    },
};

export default nextConfig;
