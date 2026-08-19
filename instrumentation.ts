import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({
    serviceName: "link-lang-frontend",
  });
}
