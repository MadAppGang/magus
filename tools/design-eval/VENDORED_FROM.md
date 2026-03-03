# Vendored Code Attribution

## Design2Code Metrics

**Source:** https://github.com/NoviScl/Design2Code
**License:** MIT
**Files vendored:**
- `src/design_eval/metrics/design2code/visual_score.py` — adapted from `Design2Code/metrics/visual_score.py`
- `src/design_eval/metrics/design2code/block_extraction.py` — block matching functions extracted from `visual_score.py`
- `src/design_eval/metrics/design2code/ocr_free_utils.py` — adapted from `Design2Code/metrics/ocr_free_utils.py`

**Adaptations:**
- Removed file I/O — accepts PIL images and block dicts directly
- CLIP scoring made optional (requires `[full]` extras)
- Removed HTML pre-processing and screenshot generation
- Removed debug visualization and matplotlib dependencies
- Extracted block matching into separate module for reuse

**Citation:**
```bibtex
@article{si2024design2code,
  title={Design2Code: How Far Are We From Automating Front-End Engineering?},
  author={Si, Chenglei and others},
  journal={arXiv preprint arXiv:2403.03163},
  year={2024}
}
```
