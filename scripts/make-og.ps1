# Renders public/og.png, the 1200x630 link-preview card.
#
# Kept as a script rather than a binary-only edit so the card can be re-made when the artwork
# or the wording changes: run it from the repo root with PowerShell.
#
#   powershell -File scripts/make-og.ps1
#
# The mark is re-cropped from the full-resolution source rather than scaled up from the
# 160x160 asset the header uses (same square the app shows: S=880 around cx=765, cy=610).
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src = [System.Drawing.Image]::FromFile((Join-Path $root 'src/logo.jpg'))

$crop = New-Object System.Drawing.Rectangle(325, 170, 880, 880)

$width = 1200
$height = 630
$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# The app's own background colour, so the card and the icon badge match.
$g.Clear([System.Drawing.Color]::FromArgb(11, 11, 15))

# Mark, clipped round exactly like the header logo.
$size = 240
$mx = 90
$my = 195
$circle = New-Object System.Drawing.Drawing2D.GraphicsPath
$circle.AddEllipse($mx, $my, $size, $size)
$g.SetClip($circle)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle($mx, $my, $size, $size)), $crop, [System.Drawing.GraphicsUnit]::Pixel)
$g.ResetClip()

$white = [System.Drawing.Brushes]::White
$bold = New-Object System.Drawing.Font('Segoe UI', 92, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('danfeed', $bold, $white, 370, 226)

$grey = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 154, 160, 166))
$regular = New-Object System.Drawing.Font('Segoe UI', 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('A vertical, swipeable feed of Danbooru media.', $regular, $grey, 373, 350)

$out = Join-Path $root 'public/og.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
$src.Dispose()

$info = Get-Item $out
"wrote $($info.FullName)  $([Math]::Round($info.Length / 1KB, 1)) KB"
