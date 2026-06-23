from setuptools import find_namespace_packages, setup


setup(
    name="cli-anything-jianying",
    version="0.1.0",
    description="CLI-Anything harness for the local Windows Jianying Pro desktop app.",
    packages=find_namespace_packages(include=["cli_anything.*"]),
    install_requires=[
        "click>=8.0.0",
        "prompt-toolkit>=3.0.0",
        "Pillow>=9.0.0",
    ],
    entry_points={
        "console_scripts": [
            "cli-anything-jianying=cli_anything.jianying.jianying_cli:main",
        ],
    },
    package_data={
        "cli_anything.jianying": ["skills/*.md"],
    },
    python_requires=">=3.10",
)
