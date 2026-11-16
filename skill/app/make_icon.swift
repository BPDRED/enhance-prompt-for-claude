// Draws the Enhance Prompt app icon (approved design: board 9, silver tile, everything in clay):
// an open circle with three sparkles in its gap at the top-left, and the Claude star inside.
// Saves the PNG sizes macOS needs into the folder given as argument; build.sh turns that folder
// into AppIcon.icns with Apple's `iconutil`. Runs only at build time, made like the Command+Enter icon.
// Numbers use a 1024 x 1024 grid with y going down, the same as the design board.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

let clay = rgb(0xd97757)
let center = CGPoint(x: 512, y: 512)

// Claude star: end points of the original drawing (same as the Command+Enter icon), at 78%.
let rays: [CGPoint] = [(717, 512), (655, 419), (613, 322), (496, 333), (392, 340), (366, 435),
                       (313, 529), (365, 615), (414, 704), (518, 682), (630, 680), (677, 596)]
    .map { CGPoint(x: $0.0, y: $0.1) }
let starScale: CGFloat = 0.78

/// A four-point sparkle with slightly rounded sides.
func addSparkle(_ ctx: CGContext, _ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat) {
    let c = r * 0.16
    ctx.move(to: CGPoint(x: cx, y: cy - r))
    ctx.addQuadCurve(to: CGPoint(x: cx + r, y: cy), control: CGPoint(x: cx + c, y: cy - c))
    ctx.addQuadCurve(to: CGPoint(x: cx, y: cy + r), control: CGPoint(x: cx + c, y: cy + c))
    ctx.addQuadCurve(to: CGPoint(x: cx - r, y: cy), control: CGPoint(x: cx - c, y: cy + c))
    ctx.addQuadCurve(to: CGPoint(x: cx, y: cy - r), control: CGPoint(x: cx - c, y: cy - c))
    ctx.closePath()
}

/// Draws the icon at `pixels` x `pixels`. `points` is the size macOS shows it at:
/// at 16 and 32 points the lines get a little thicker so they stay visible.
func drawIcon(pixels: Int, points: Int) -> CGImage {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8,
                        bytesPerRow: 0, space: space,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.translateBy(x: 0, y: CGFloat(pixels))
    ctx.scaleBy(x: CGFloat(pixels) / 1024, y: -CGFloat(pixels) / 1024)
    let small = points <= 32
    let boost: CGFloat = points <= 16 ? 1.8 : (points <= 32 ? 1.4 : 1.0)

    let square = CGRect(x: 100, y: 100, width: 824, height: 824)
    let shape = CGPath(roundedRect: square, cornerWidth: 185, cornerHeight: 185, transform: nil)

    // Soft shadow under the tile.
    ctx.addPath(CGPath(roundedRect: square.offsetBy(dx: 0, dy: 14), cornerWidth: 185, cornerHeight: 185, transform: nil))
    ctx.setFillColor(rgb(0x000000, 0.18))
    ctx.fillPath()

    // Silver tile, light at the top, darker at the bottom, with a fine grid at the bigger sizes.
    ctx.saveGState()
    ctx.addPath(shape)
    ctx.clip()
    let gradient = CGGradient(colorsSpace: space, colors: [rgb(0xfbfbfc), rgb(0xcfd2d8)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 100), end: CGPoint(x: 0, y: 924), options: [])
    if !small {
        ctx.setStrokeColor(rgb(0x000000, 0.07))
        ctx.setLineWidth(3)
        var v: CGFloat = 100
        while v <= 924 {
            ctx.move(to: CGPoint(x: v, y: 100)); ctx.addLine(to: CGPoint(x: v, y: 924))
            ctx.move(to: CGPoint(x: 100, y: v)); ctx.addLine(to: CGPoint(x: 924, y: v))
            v += 109
        }
        ctx.strokePath()
    }
    ctx.restoreGState()

    // Thin edge.
    ctx.addPath(CGPath(roundedRect: square.insetBy(dx: 2, dy: 2), cornerWidth: 183, cornerHeight: 183, transform: nil))
    ctx.setStrokeColor(rgb(0x000000, 0.10))
    ctx.setLineWidth(4)
    ctx.strokePath()

    ctx.setStrokeColor(clay)
    ctx.setFillColor(clay)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)

    // Open circle (radius 280), from 262° round to 178° (y down), leaving the top-left gap for the sparkles.
    let radius: CGFloat = 280
    ctx.setLineWidth(24 * boost)
    let steps = 160
    for i in 0...steps {
        let degrees = 262 + 276 * Double(i) / Double(steps)
        let a = degrees * .pi / 180
        let p = CGPoint(x: 512 + radius * CGFloat(cos(a)), y: 512 + radius * CGFloat(sin(a)))
        if i == 0 { ctx.move(to: p) } else { ctx.addLine(to: p) }
    }
    ctx.strokePath()

    // Sparkles in the gap. The smallest one is left out at 16 and 32, where it would only be a dot.
    addSparkle(ctx, 297, 332, 96)
    addSparkle(ctx, 398, 196, 48)
    if !small { addSparkle(ctx, 420, 300, 24) }
    ctx.fillPath()

    // Claude star in the middle, same thin line as the circle.
    ctx.setLineWidth(24 * boost)
    for end in rays {
        ctx.move(to: center)
        ctx.addLine(to: CGPoint(x: 512 + (end.x - 512) * starScale, y: 512 + (end.y - 512) * starScale))
    }
    ctx.strokePath()

    return ctx.makeImage()!
}

func save(_ image: CGImage, _ name: String) {
    let url = URL(fileURLWithPath: outDir).appendingPathComponent(name)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    CGImageDestinationFinalize(dest)
}

for points in [16, 32, 128, 256, 512] {
    save(drawIcon(pixels: points, points: points), "icon_\(points)x\(points).png")
    save(drawIcon(pixels: points * 2, points: points), "icon_\(points)x\(points)@2x.png")
}
