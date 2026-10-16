# Black hole backdrop

Adapted from the vgpu "Optimized Black Hole" example
(https://vgpu.sh/examples/optimized-black-hole,
source `apps/docs/examples/optimized-black-hole` in https://github.com/vercel-labs/vgpu),
MIT License, Copyright (c) 2025 Vercel, Inc. — see `LICENSE` in this folder.

Shaders, pipeline and settings are kept as upstream. `renderer.ts` is changed only to:
frame-rate cap, a `still` mode (one frame, for reduced motion), an `onFailure` callback instead
of throwing, and per-host layout overrides (`centerX`, `centerY`, `cameraRoll`, `mouseYaw`).
