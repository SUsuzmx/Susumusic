# =============================================================
# replace-icons.ps1
# 将 build\Web App\ 中的新图标文件替换为应用图标
# 在 PowerShell 中执行：.\replace-icons.ps1
# =============================================================

$ErrorActionPreference = 'Stop'
$buildDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$webAppDir = Join-Path $buildDir 'Web App'

# ── 1. 替换 icon.png（Electron 打包用）──────────────────────
$src512 = Join-Path $webAppDir 'android-chrome-512.png'
$destPng = Join-Path $buildDir 'icon.png'
Write-Host "[1/2] 复制 android-chrome-512.png → icon.png ..."
Copy-Item -Path $src512 -Destination $destPng -Force
Write-Host "      ✓ $destPng"

# ── 2. 生成多尺寸 icon.ico（Windows 桌面/任务栏图标）────────
#    使用 System.Drawing 将 PNG 转换为包含 4 个尺寸的 ICO：
#    256x256、48x48、32x32、16x16
Write-Host "[2/2] 生成 icon.ico ..."
Add-Type -AssemblyName System.Drawing

function Resize-Image([System.Drawing.Image]$img, [int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($img, 0, 0, $size, $size)
    $g.Dispose()
    return $bmp
}

function Write-IcoFile([string]$srcPath, [string]$destPath, [int[]]$sizes) {
    $src = [System.Drawing.Image]::FromFile($srcPath)
    $stream = New-Object System.IO.MemoryStream

    # ICO 文件头：ICONDIR
    $bw = New-Object System.IO.BinaryWriter($stream)
    $bw.Write([uint16]0)           # Reserved
    $bw.Write([uint16]1)           # Type: 1 = ICO
    $bw.Write([uint16]$sizes.Count) # Image count

    # 预分配数组，后面填写偏移
    $images = @()
    foreach ($size in $sizes) {
        $bmp   = Resize-Image $src $size
        $imgMs = New-Object System.IO.MemoryStream
        $bmp.Save($imgMs, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        $images += $imgMs
    }

    # ICONDIRENTRY（每个图像 16 字节）
    $headerSize  = 6 + 16 * $sizes.Count
    $currentOffset = $headerSize
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $sz    = $sizes[$i]
        $bytes = $images[$i].ToArray()
        if ($sz -ge 256) { $dimByte = [byte]0 } else { $dimByte = [byte]$sz }
        $bw.Write($dimByte)          # Width  (0=256)
        $bw.Write($dimByte)          # Height (0=256)
        $bw.Write([byte]0)           # ColorCount
        $bw.Write([byte]0)           # Reserved
        $bw.Write([uint16]1)         # Planes
        $bw.Write([uint16]32)        # BitCount
        $bw.Write([uint32]$bytes.Length)   # SizeInBytes
        $bw.Write([uint32]$currentOffset)  # ImageOffset
        $currentOffset += $bytes.Length
    }

    # 写入图像数据
    foreach ($imgMs in $images) {
        $bw.Write($imgMs.ToArray())
        $imgMs.Dispose()
    }

    $bw.Flush()
    $src.Dispose()

    [System.IO.File]::WriteAllBytes($destPath, $stream.ToArray())
    $stream.Dispose()
}

$destIco = Join-Path $buildDir 'icon.ico'
Write-IcoFile -srcPath $src512 -destPath $destIco -sizes @(256, 64, 48, 32, 16)
Write-Host "      ✓ $destIco"

Write-Host ""
Write-Host "=== 完成！==="
Write-Host "  icon.png  → 已替换（Electron 打包用）"
Write-Host "  icon.ico  → 已生成（Windows 桌面/任务栏）"
