const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

config.transformer.babelTransformerPath = require.resolve("react-native-svg-transformer/expo");

config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== "svg");

config.resolver.sourceExts.push("svg");

module.exports = withNativewind(config);
