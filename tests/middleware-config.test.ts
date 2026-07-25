import { describe, expect, it } from "vitest";

import { config } from "@/middleware";

describe("alcance del middleware administrativo", () => {
  it("no aplica el secreto del directorio a las rutas QR con autenticación propia", () => {
    expect(config.matcher).not.toContain("/api/assignments/:path*");
    expect(config.matcher).toContain("/api/students/:path*");
  });
});
