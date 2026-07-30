require "language/node"

class Visuales < Formula
  desc "Search and download visuales.uclv.cu content from the terminal"
  homepage "https://github.com/Carlos-err406/visuales-search"
  url "https://registry.npmjs.org/visuales/-/visuales-1.0.0.tgz"
  sha256 "c8eb6dfc25a813be41f2dc9936dee2bc820f9e5f99a8299750adf4b59dad31d4"
  license "ISC"

  depends_on "node"

  def install
    system "npm", "install", "--omit=dev", "--ignore-scripts", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink libexec/"bin/visuales"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/visuales --version")
  end
end
