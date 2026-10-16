//! Optional GPU compositing path over `photocraft-gpu::Compositor` (wgpu 30).
//!
//! The compositor renders each chunk as straight-alpha float pixels into a chunk texture; we copy
//! those into one region-sized destination texture, then read it back and convert to RGBA8 the same
//! way the CPU path does (`clamp(0,1)*255`), so GPU and CPU outputs match. Device creation is async
//! (WebGPU), so `init` is async; rendering is async because of buffer map-back.
//!
//! On native targets wgpu has no browser backend here, so `Gpu::init` reports unavailable; the
//! engine keeps the CPU path. All failures are reported, never panic.

use photocraft_doc::Document;
use photocraft_geom::Rect;
use photocraft_gpu::Compositor;

pub struct Gpu {
    device: wgpu::Device,
    queue: wgpu::Queue,
    comp: Compositor,
    acc_format: wgpu::TextureFormat,
}

/// 256-byte row alignment that `copy_texture_to_buffer` requires.
fn align_256(n: u32) -> u32 {
    n.div_ceil(256) * 256
}

impl Gpu {
    pub async fn init() -> Result<Gpu, String> {
        let instance = wgpu::Instance::default();
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })
            .await
            .map_err(|e| format!("no WebGPU adapter: {e}"))?;
        let acc_format = Compositor::preferred_acc_format(&adapter);
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor { label: Some("tjm_gpu"), required_limits: adapter.limits(), ..Default::default() })
            .await
            .map_err(|e| format!("no WebGPU device: {e}"))?;
        let comp = Compositor::try_new_with_format(&device, acc_format).map_err(|e| format!("compositor: {e}"))?;
        Ok(Gpu { device, queue, comp, acc_format })
    }

    pub fn supports(&self, doc: &Document) -> Result<(), String> {
        self.comp.supports(doc).map_err(|e| e.to_string())
    }

    /// GPU-composite `region` (document pixels) → straight-alpha RGBA8. Async because of readback.
    pub async fn render(&mut self, doc: &Document, region: Rect) -> Result<(u32, u32, Vec<u8>), String> {
        let (w, h) = (region.width(), region.height());
        if w == 0 || h == 0 {
            return Ok((0, 0, Vec::new()));
        }
        // Destination texture holds the whole region in the accumulator's float format.
        let dest = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("tjm_gpu_dest"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.acc_format,
            usage: wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        // Compositor::render owns the encoder and submits it; our sink records chunk→dest copies.
        self.comp
            .render(&self.device, &self.queue, doc, region, |enc, out| {
                let cw = out.rect.width().min(w.saturating_sub((out.rect.x0 - region.x0).max(0) as u32));
                let ch = out.rect.height().min(h.saturating_sub((out.rect.y0 - region.y0).max(0) as u32));
                if cw == 0 || ch == 0 {
                    return;
                }
                enc.copy_texture_to_texture(
                    wgpu::TexelCopyTextureInfo { texture: out.texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                    wgpu::TexelCopyTextureInfo {
                        texture: &dest,
                        mip_level: 0,
                        origin: wgpu::Origin3d { x: (out.rect.x0 - region.x0) as u32, y: (out.rect.y0 - region.y0) as u32, z: 0 },
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::Extent3d { width: cw, height: ch, depth_or_array_layers: 1 },
                );
            })
            .map_err(|e| e.to_string())?;

        // Read the destination back.
        let bpp = self.acc_format.block_copy_size(None).unwrap_or(16); // Rgba32F=16, Rgba16F=8
        let bytes_per_row = align_256(w * bpp);
        let buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("tjm_gpu_readback"),
            size: (bytes_per_row * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("tjm_gpu_readback") });
        enc.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: &dest, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo { buffer: &buf, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(bytes_per_row), rows_per_image: Some(h) } },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.queue.submit([enc.finish()]);

        let (tx, rx) = futures_channel::oneshot::channel();
        buf.slice(..).map_async(wgpu::MapMode::Read, move |r| { let _ = tx.send(r); });
        // Natively (tests) poll to completion; on the web the browser drives the map and `await` yields.
        #[cfg(not(target_arch = "wasm32"))]
        let _ = self.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
        rx.await.map_err(|_| "map cancelled".to_string())?.map_err(|e| format!("map: {e}"))?;

        let data = buf.slice(..).get_mapped_range().map_err(|e| format!("mapped range: {e:?}"))?;
        let out = self.to_rgba8(&data, w, h, bytes_per_row, bpp);
        drop(data);
        buf.unmap();
        Ok((w, h, out))
    }

    fn to_rgba8(&self, data: &[u8], w: u32, h: u32, bytes_per_row: u32, bpp: u32) -> Vec<u8> {
        let mut out = vec![0u8; (w * h * 4) as usize];
        let f16 = bpp == 8;
        for y in 0..h {
            let row = &data[(y * bytes_per_row) as usize..];
            for x in 0..w {
                let si = (x * bpp) as usize;
                let di = ((y * w + x) * 4) as usize;
                for c in 0..4 {
                    let v = if f16 {
                        let b = &row[si + c * 2..];
                        half::f16::from_le_bytes([b[0], b[1]]).to_f32()
                    } else {
                        let b = &row[si + c * 4..];
                        f32::from_le_bytes([b[0], b[1], b[2], b[3]])
                    };
                    out[di + c] = (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
                }
            }
        }
        out
    }
}
