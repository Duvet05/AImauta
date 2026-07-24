# AImauta teacher avatar

`aimauta-teacher.glb` is derived from `avatars/mpfb.glb` in
[met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead) at commit
`eed58d198076a7e1e825f804802921c4d3804d46`.

The upstream README identifies this MPFB/MakeHuman example avatar as
[CC0](https://creativecommons.org/publicdomain/zero/1.0/). It is a synthetic
character and is not based on a student or teacher.

Integrity:

- upstream `mpfb.glb` SHA-256:
  `63c645a2a863b9972e9a9c2ed576a1de4c390b8475508e1473e69c87a3ee299c`
- optimized `aimauta-teacher.glb` SHA-256:
  `f732f48f6206e2c87f66fa7909302c74de791b83f9e838e32e0ac6f0d9ede957`

The checked-in asset was generated on PowerEdge with:

```text
gltf-transform 4.4.1 optimize mpfb.glb aimauta-teacher.glb \
  --compress meshopt --texture-compress webp --texture-size 1024
```

The optimization reduces the file from 36.82 MB to 2.80 MB. The resulting GLB
uses `EXT_meshopt_compression`, `EXT_texture_webp`, and
`KHR_mesh_quantization`.
